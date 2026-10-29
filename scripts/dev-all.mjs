// Levanta en paralelo la web (next dev) y el worker, y los corta juntos con Ctrl+C.
import { spawn } from "node:child_process";

const procs = [
  spawn("npm", ["run", "dev"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn("npm", ["run", "dev:worker"], { stdio: "inherit", shell: process.platform === "win32" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => code && code !== 0 && stop()));
