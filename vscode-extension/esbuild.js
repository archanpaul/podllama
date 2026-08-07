const { execSync } = require('child_process');
const path = require('path');

const isWatch = process.argv.includes('--watch');

function build() {
  console.log('Building PodLlama VS Code Extension via esbuild...');
  const cmd = `npx -y esbuild src/extension.ts --bundle --platform=node --target=node18 --external:vscode --outfile=dist/extension.js ${isWatch ? '--watch' : ''}`;
  execSync(cmd, { cwd: __dirname, stdio: 'inherit' });
}

try {
  build();
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
