/**
 * The command guard. Its whole job is to make "read-only" mean something,
 * because the agent runs as whatever SSH user Termix saved — here, root.
 */

/** Commands that only report. Anything else needs allowExec: "all". */
const READ_ONLY = [
  /^df(\s|$)/,
  /^du(\s|$)/,
  /^free(\s|$)/,
  /^uptime$/,
  /^uname(\s|$)/,
  /^ps(\s|$)/,
  /^lsblk(\s|$)/,
  /^ls(\s|$)/,
  /^ll(\s|$)/,
  /^pwd$/,
  /^whoami$/,
  /^id$/,
  /^hostname$/,
  /^nproc$/,
  /^date$/,
  /^grep(\s|$)/,
  /^head(\s|$)/,
  /^tail(\s|$)/,
  /^wc(\s|$)/,
  /^sort(\s|$)/,
  /^awk(\s|$)/,
  /^find(\s|$)/,
  /^ss(\s|$)/,
  /^netstat(\s|$)/,
  /^ip(\s|$)/,
  /^ping(\s|$)/,
  /^systemctl\s+status(\s|$)/,
  /^systemctl\s+list-units(\s|$)/,
  /^journalctl(\s|$)/,
  /^docker\s+ps(\s|$)/,
  /^docker\s+logs(\s|$)/,
  /^docker\s+inspect(\s|$)/,
  /^cat\s+\/proc\//,
  /^cat\s+\/sys\//,
  /^cat\s+\/etc\/(os-release|hostname|hosts|resolv\.conf|fstab|nginx\/)/,
];

/**
 * In read-only mode a command must be one command: no chaining, no pipes, no
 * redirection, no substitution. Otherwise `df; rm -rf /` matches `df`.
 */
const SHELL_META = /[;&|`$><\n\r]/;

export function checkCommand(command, mode) {
  const text = String(command ?? "").trim();
  if (!text) return { ok: false, reason: "the command is empty" };
  if (text.length > 4000) {
    return { ok: false, reason: "the command is longer than 4000 characters" };
  }

  if (mode === "off") {
    return {
      ok: false,
      reason:
        "running commands is turned off (allowExec is \"off\"); only inventory tools are available",
    };
  }
  if (mode === "all") return { ok: true };

  if (SHELL_META.test(text)) {
    return {
      ok: false,
      reason:
        "read-only mode runs a single command: no ; & | ` $ > < or newlines. Set allowExec to \"all\" to allow pipelines and redirection.",
    };
  }
  if (!READ_ONLY.some((pattern) => pattern.test(text))) {
    return {
      ok: false,
      reason: `"${text.split(/\s+/)[0]}" is not on the read-only list. Allowed prefixes: df, du, free, uptime, uname, ps, ls, lsblk, ss, ip, systemctl status, journalctl, docker ps/logs, cat /proc|/sys|/etc. Set allowExec to "all" to run anything.`,
    };
  }
  return { ok: true };
}
