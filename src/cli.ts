// Entry point + command definitions

import { Command } from "commander";

const program = new Command();

program
  .name("ai-skills-sync")
  .description("Per-project AI skill routing for coding agents")
  .version("0.1.0");

program.parse();
