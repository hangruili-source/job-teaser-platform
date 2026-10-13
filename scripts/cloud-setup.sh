#!/usr/bin/env bash
set -euo pipefail
cd /workspace/job-teaser-platform
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<13)) throw new Error("Node.js 22.13+ required; Node.js 24 recommended")'
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
if ! command -v chromium >/dev/null 2>&1 && ! node --input-type=module -e 'import {chromium} from "playwright"; import {existsSync} from "node:fs"; process.exit(existsSync(process.env.CHROMIUM_EXECUTABLE_PATH || chromium.executablePath()) ? 0 : 1)'; then
  export PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
  npx playwright install chromium
fi
npm run build
npm test
