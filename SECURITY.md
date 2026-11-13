# Security policy

## Supported versions

Only the latest release of RNGidle Shop Helper gets security fixes. Check the [Releases page](https://github.com/alexsasha2750/rngidle-helper/releases) for the current version, or click the version number in the extension's menu to look for updates.

| Version | Supported |
| --- | --- |
| Latest release (1.4.x) | Yes |
| Anything older, including all alpha and beta builds | No, please update |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (<https://github.com/alexsasha2750/rngidle-helper/security/advisories/new>). Include:

- what the problem is and what an attacker could do with it,
- the extension version (shown at the top of the menu) and your Chrome version,
- steps to reproduce it, or a short proof of concept.

This is a hobby project maintained by one person. I aim to reply within **7 days**, and to fix confirmed problems in a new release as soon as I reasonably can. I'll credit you in the release notes unless you'd rather stay anonymous.

## What counts as a security issue

For example:

- another website or extension being able to read your settings, history, or session through this extension,
- the extension spending EP or buying something you did not set up or confirm,
- the extension sending your data anywhere other than `rngidle.fun`,
- the update checker downloading or opening anything other than a ZIP from this repository's releases,
- anything that lets a page script trigger the extension's actions.

Bugs that do not put you or your account at risk (wrong text, layout, a missed restock) are ordinary issues and can be reported publicly.

## How the extension is built to limit risk

- It only has access to `https://rngidle.fun/*`, and uses your existing signed-in game session. It never asks for or stores your password.
- Purchases check that the signed-in account matches the one the settings were made for, and are never forced.
- Settings and history stay in your browser's local extension storage; nothing is uploaded.
- The update checker contacts GitHub only, and only accepts download and release links under this repository.

## Using the extension is your own risk

RNGidle's [terms](https://rngidle.fun/terms) prohibit bots, scripts, auto-clickers and tools that play for you. Automatic buying may break those terms and could lead to a progress reset or ban. That is a risk of using the tool, not a vulnerability in it, so it is not covered by this policy.
