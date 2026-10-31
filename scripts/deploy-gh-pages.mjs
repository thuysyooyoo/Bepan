import { execSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
writeFileSync(join(distDir, '.nojekyll'), '');

const gitInDist = join(distDir, '.git');
if (existsSync(gitInDist)) {
  rmSync(gitInDist, { recursive: true, force: true });
}

const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();

const run = (cmd) => execSync(cmd, { cwd: distDir, stdio: 'inherit' });

run('git init -b gh-pages');
run('git config user.name "thuysyooyoo"');
run('git config user.email "thuysyooyoo@users.noreply.github.com"');
run('git add -A');
run('git commit -m "chore: deploy live demo to gh-pages"');
run(`git push -f "${remoteUrl}" gh-pages:gh-pages`);

rmSync(gitInDist, { recursive: true, force: true });
console.log(' Deployed dist/ to gh-pages successfully!');
