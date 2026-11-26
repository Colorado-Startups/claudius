// A failed GitHub call as a fixed reason, never the error's own text.
//
// GitHub's rate-limit message names an installation or user ID, and a status
// line carries a number. A collector that echoed either put it on the public
// Quality page, where an adopter's privacy gate refuses an ID and fails the
// build (Claudius#115, seen 2026-11-24). So the text is read to classify the
// failure and then dropped: a reason is one of the fixed phrases below.
//
// It takes whatever a read threw: an Error, a gh process error (stderr), an
// HTTP client error (status), a GraphQL error object ({ type, message }) or a
// string. No dependency, so any collector may import it.

const RATE_LIMITED = /rate[ _-]?limit|abuse detection|too many requests|\bHTTP 429\b/i;
const AUTH = /\bHTTP 40[13]\b|bad credentials|requires authentication|must authenticate|not accessible by integration|\b(?:FORBIDDEN|UNAUTHORIZED|INSUFFICIENT_SCOPES)\b|not logged in(?:to)?\b|gh auth login|\bGH_TOKEN\b/i;

function textOf(err) {
  if (typeof err === 'string') return err;
  return [err?.stderr, err?.message, err?.type].filter(Boolean).map(String).join('\n');
}

// 'rate limited', 'auth', or '' for any other failure. A rate limit is checked
// first: GitHub answers a primary limit with a 403.
function ghReason(err) {
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status);
  const text = textOf(err);
  if (status === 429 || RATE_LIMITED.test(text)) return 'rate limited';
  if (status === 401 || status === 403 || AUTH.test(text)) return 'auth';
  return '';
}

// "<what> failed", then " for <where>" and ": <reason>" when there are any:
// "gh api graphql failed: rate limited", "gh pr list failed for acme/site".
// `what` and `where` are the caller's own fixed words, never an error's.
export function ghFailed(what, err, where = '') {
  const reason = ghReason(err);
  return `${what} failed${where ? ` for ${where}` : ''}${reason ? `: ${reason}` : ''}`;
}
