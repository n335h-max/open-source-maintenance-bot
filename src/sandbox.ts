import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface SandboxResult { exitCode: number | null; stdout: string; stderr: string; }
export interface Sandbox {
  run(command: string, args: string[], workspace: string, timeoutMs: number): Promise<SandboxResult>;
}

export class DockerSandbox implements Sandbox {
  constructor(private readonly image = process.env.AGENT_IMAGE ?? "open-source-maintenance-agent:0.1.0") {
    validateAgentImage(this.image);
  }

  async run(command: string, args: string[], workspace: string, timeoutMs: number): Promise<SandboxResult> {
    const dockerArgs = buildDockerArgs(this.image, workspace, command, args);
    return runProcess("docker", dockerArgs, timeoutMs);
  }
}

export function validateAgentImage(image: string): void {
  if (!image.trim() || image.endsWith(":latest")) {
    throw new Error("AGENT_IMAGE must be pinned to a versioned tag or digest, not latest.");
  }
  if (image.includes("@sha256:") && !/@sha256:[a-f0-9]{64}$/i.test(image)) {
    throw new Error("AGENT_IMAGE digest must be a full sha256 digest.");
  }
}

export function buildDockerArgs(image: string, workspace: string, command: string, args: string[]): string[] {
  validateAgentImage(image);
  return [
    "run", "--rm", "--init", "--pull=never", "--user", "65532:65532",
    "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--pids-limit=128", "--memory=2g", "--cpus=2", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
    "-e", "HOME=/tmp", "-e", "CODEX_HOME=/tmp/codex", ...providerEnvArgs(),
    "-v", `${workspace}:/workspace:rw`, "-w", "/workspace", image, command, ...args,
  ];
}

function providerEnvArgs(): string[] {
  const values = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
  return values.flatMap((name) => process.env[name] ? ["-e", `${name}=${process.env[name]}`] : []);
}

export class LocalSandbox implements Sandbox {
  async run(command: string, args: string[], workspace: string, timeoutMs: number): Promise<SandboxResult> { return runProcess(command, args, timeoutMs, workspace); }
}

export async function createWorkspace(): Promise<string> {
  const path = join(tmpdir(), `maintenance-bot-${randomUUID()}`);
  await mkdir(path, { recursive: true, mode: 0o777 });
  return path;
}

export async function removeWorkspace(path: string): Promise<void> { await rm(path, { recursive: true, force: true }); }

async function runProcess(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH ?? "", HOME: "/tmp", CODEX_HOME: "/tmp/codex" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (exitCode) => { clearTimeout(timer); resolve({ exitCode, stdout, stderr }); });
  });
}
