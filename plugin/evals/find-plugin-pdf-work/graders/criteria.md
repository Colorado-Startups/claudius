---
type: llm
---

PASS if the reply leads with an Anthropic-built or Anthropic-reviewed pick for PDFs (for example a pdf or pdf-viewer plugin or skill), labels its tier (Anthropic-built or Anthropic-reviewed), gives how to turn it on (claude plugin install <name>@claude-plugins-official, or the Customize page), and turns it on or says it will, without asking for a yes. FAIL if it leads with a community or third-party repo, omits the tier or the turn-on step, stops to ask whether it may install, or says it already installed something it did not.
