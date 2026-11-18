-- These operational tables are accessed exclusively by the server's service role.
do $$ declare t text; begin
  foreach t in array array['collection_runs','collection_tasks','collection_pages','collection_seen','feed_tokens','merchant_jobs'] loop
    execute format('create policy service_operations on public.%I for all to service_role using(true) with check(true)',t);
  end loop;
end $$;

create function public.sync_identity_sequences() returns void language plpgsql set search_path='' as $$
declare table_name text;largest bigint;begin
  foreach table_name in array array['categories','products','price_history'] loop
    execute format('select max(id) from public.%I',table_name) into largest;
    perform setval(pg_get_serial_sequence('public.'||table_name,'id'),coalesce(largest,1),largest is not null);
  end loop;
end $$;
revoke execute on function public.sync_identity_sequences() from public,anon,authenticated;
grant execute on function public.sync_identity_sequences() to service_role;
