import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { fetchNavigation, fetchCategoryPage, normalizeProduct, UpstreamError } from '../../shared/kaspi.mjs';
import db from '../models/db.js';
import repository from '../services/catalogRepository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const controller = new AbortController();
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

function sleep(ms) {
  return new Promise(resolve => {
    if (controller.signal.aborted) return resolve();
    const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort',finish); resolve(); };
    const timer = setTimeout(finish,ms);
    controller.signal.addEventListener('abort',finish,{once:true});
  });
}

async function retry(operation) {
  for (let attempt=0;attempt<3;attempt++) {
    try { return await operation(); }
    catch (error) {
      if (controller.signal.aborted || attempt===2) throw error;
      if (error instanceof UpstreamError && error.status && ![408,429,500,502,503,504].includes(error.status)) throw error;
      const delay = Math.max(error.retryAfter || 0,2 ** attempt * 2);
      emit({type:'retry',attempt:attempt+1,delay,message:error.message});
      await sleep(delay*1000);
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    'category-id':{type:'string'},'city-id':{type:'string',default:'750000000'},
    'max-pages':{type:'string',default:'3'},workers:{type:'string',default:'1'},
    full:{type:'boolean',default:false},discover:{type:'boolean',default:false},
    'discover-only':{type:'boolean',default:false},'run-id':{type:'string'},'cancel-file':{type:'string'},
  }});
  const cityId = values['city-id'];
  const maxPages = Number(values['max-pages']);
  const workers = Number(values.workers);
  const categoryId = values['category-id'] ? Number(values['category-id']) : null;
  if (!/^\d{9}$/.test(cityId) || !Number.isInteger(maxPages) || maxPages<1 || maxPages>100 || !Number.isInteger(workers) || workers<1 || workers>4 || (categoryId!==null && (!Number.isSafeInteger(categoryId)||categoryId<1))) throw new Error('Некорректные параметры сбора');
  let cancelFile = values['cancel-file'];
  const watcher = setInterval(() => { if (cancelFile && existsSync(cancelFile)) controller.abort(); },500);
  watcher.unref();
  await db.initialize();
  let runId = values['run-id'];
  const standalone = !runId;
  let errors = [];
  let savedTotal = 0;
  let skippedTotal = 0;
  let fullComplete = false;
  let pagesDone = 0;
  let categoriesDone = 0;
  let heartbeat;
  try {
    if (!runId && !values['discover-only']) {
      runId = randomUUID();
      await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_scraper_run ON scraper_runs((1)) WHERE status IN ('running','cancelling')");
      await db.query("INSERT INTO scraper_runs(id,status,started_at,options,progress) VALUES($1,'running',$2,$3,'{}')",[runId,new Date().toISOString(),JSON.stringify({categoryId,cityId,maxPages,workers,full:values.full,engine:'http',ownerPid:process.pid,ownerHost:hostname(),ownerMode:'standalone'})]);
      cancelFile ||= path.join(root,'backend/data',`${runId}.cancel`);
    }
    if (runId) {
      const beat = async () => {
        const stamp = new Date().toISOString();
        emit({type:'heartbeat',heartbeat:stamp});
        if (standalone) await db.query('UPDATE scraper_runs SET progress=$1 WHERE id=$2',[JSON.stringify({saved:savedTotal,pages:pagesDone,completedCategories:categoriesDone,heartbeat:stamp,events:[]}),runId]);
      };
      await beat();
      heartbeat = setInterval(() => beat().catch(error => process.stderr.write(error.message+'\n')),15000);
      heartbeat.unref();
    }
    const active = Number((await db.query('SELECT COUNT(*) AS count FROM categories WHERE source_active=1')).rows[0].count);
    if (values.discover || values['discover-only'] || !active) {
      emit({type:'discovery',message:'Получаем текущее дерево категорий Kaspi'});
      const nodes = await retry(() => fetchNavigation(cityId,{signal:controller.signal}));
      const discovery = await repository.saveNavigation(nodes,cityId);
      emit({type:'discovery-complete',...discovery});
    }
    if (values['discover-only']) return 0;
    const categories = await repository.prepareTasks(runId,cityId,categoryId);
    emit({type:'start',categories:categories.length,workers,full:values.full,engine:'http',max_pages:values.full ? null : maxPages,city_id:cityId});
    let index = 0;
    async function worker() {
      while (!controller.signal.aborted && index<categories.length) {
        const category = categories[index++];
        const task = (await db.query('SELECT * FROM catalog_tasks WHERE run_id=$1 AND category_id=$2',[runId,category.id])).rows[0];
        if (task.status==='completed') continue;
        let page = Number(task.next_page);
        let pageInfo;
        const pageLimit = page + maxPages;
        try {
          while (!controller.signal.aborted) {
            const result = await retry(() => fetchCategoryPage(category.source_code,cityId,page,{signal:controller.signal,pageInfo}));
            pageInfo=result.pageInfo;
            const products = [];
            let invalid = 0;
            for (const raw of result.cards) {
              try { products.push(normalizeProduct(raw,category.id,cityId)); }
              catch (error) { invalid++; emit({type:'warning',category_id:category.id,message:error.message}); }
            }
            if (result.cards.length && !products.length) throw new Error('Все карточки страницы имеют неизвестный формат');
            const limited = !values.full && page+1>=pageLimit;
            const saved = await repository.savePage({runId,categoryId:category.id,cityId,page,products,total:result.total,pageSize:result.pageSize,hasMore:result.hasMore,invalidCount:invalid,limited});
            savedTotal += saved.saved;
            pagesDone++;
            skippedTotal += invalid;
            emit({type:'page',category_id:category.id,page:page+1,saved:saved.saved,added:saved.added,total:savedTotal,expected:result.total,status:saved.status,skipped:invalid});
            page++;
            if (!result.hasMore || limited) break;
            await sleep(350);
          }
          if (!controller.signal.aborted) { categoriesDone++; emit({type:'category',category_id:category.id}); }
        } catch (error) {
          if (controller.signal.aborted) break;
          const message = `${category.name}: ${error.message}`;
          errors.push(message);
          await repository.taskFailed(runId,category.id,message);
          emit({type:'error',category_id:category.id,message});
          if (error.status===429) await sleep(Math.max(error.retryAfter || 30,30)*1000);
        }
        await sleep(350);
      }
    }
    await Promise.all(Array.from({length:Math.min(workers,categories.length)},worker));
    const audit = await repository.coverage(runId);
    fullComplete = audit.complete;
    const partial = values.full && !fullComplete && !controller.signal.aborted;
    emit({type:'finish',saved:savedTotal,skipped:skippedTotal,errors:errors.slice(-20),cancelled:controller.signal.aborted,partial,coverage:audit.summary});
    if (standalone) await db.query('UPDATE scraper_runs SET status=$1,finished_at=$2,error=$3,progress=$4 WHERE id=$5',[controller.signal.aborted?'cancelled':partial?'partial':errors.length?'failed':'completed',new Date().toISOString(),errors.join('\n').slice(-4000)||null,JSON.stringify({saved:savedTotal,coverage:audit.summary,full:values.full}),runId]);
    return errors.length || partial ? 2 : 0;
  } catch (error) {
    if (standalone && runId) await db.query('UPDATE scraper_runs SET status=$1,finished_at=$2,error=$3 WHERE id=$4',[controller.signal.aborted?'cancelled':'failed',new Date().toISOString(),controller.signal.aborted?null:error.message,runId]);
    if (controller.signal.aborted) { emit({type:'finish',saved:savedTotal,skipped:skippedTotal,errors:[],cancelled:true}); return 0; }
    throw error;
  } finally { clearInterval(watcher); clearInterval(heartbeat); await db.close(); }
}

main().then(code => { process.exitCode=code; }).catch(error => { emit({type:'error',message:error.message}); process.exitCode=1; });
