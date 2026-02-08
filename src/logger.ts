// Console output helpers

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM_CODE = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function isColorDisabled(): boolean {
  return (
    !!process.env["NO_COLOR"] ||
    process.argv.includes("--no-color")
  );
}

function style(code: string, msg: string): string {
  if (isColorDisabled()) return msg;
  return `${code}${msg}${RESET}`;
}

export function info(msg: string): void {
  process.stdout.write(style(CYAN, msg) + "\n");
}

export function success(msg: string): void {
  process.stdout.write(style(GREEN, msg) + "\n");
}

export function warn(msg: string): void {
  process.stderr.write(style(YELLOW, msg) + "\n");
}

export function error(msg: string): void {
  process.stderr.write(style(RED, msg) + "\n");
}

export function dim(msg: string): void {
  process.stdout.write(style(DIM_CODE, msg) + "\n");
}

export function header(title: string): void {
  process.stdout.write("\n" + style(`${BOLD}${CYAN}`, `  ${title}`) + "\n\n");
}
