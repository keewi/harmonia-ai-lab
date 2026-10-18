/**
 * The same code runs in two places. Locally it is the lab: uploads, processing,
 * sharing. On Vercel (LAB_HOSTED=1) it is the read-only library and share
 * links, with no uploads, no pipeline and no runs folder.
 */
export function isHosted() {
  return process.env.LAB_HOSTED === "1";
}
