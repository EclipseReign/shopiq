const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
require(path.join(root, "node_modules/dotenv")).config({
  path: path.join(root, ".env"),
  quiet: true,
});
const production = process.argv.includes("--production");
const apiPort = process.env.API_PORT || "5000";
const frontendPort = process.env.PORT || "3000";
const children = [
  spawn(process.execPath, ["backend/server.js"], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, PORT: apiPort },
  }),
  spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      production ? "start" : "dev",
      "-p",
      frontendPort,
    ],
    {
      cwd: path.join(root, "frontend"),
      stdio: "inherit",
      env: {
        ...process.env,
        BACKEND_URL: process.env.BACKEND_URL || `http://127.0.0.1:${apiPort}`,
      },
    },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (children[0].connected) children[0].send("shutdown");
  else children[0].kill();
  children[1].kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
