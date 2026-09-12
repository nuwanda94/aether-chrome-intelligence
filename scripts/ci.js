import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

console.log('==============================================');
console.log(' Running Aether CI Pipeline');
console.log('==============================================\n');

// 1. Static Syntax Analysis
console.log('▶ Step 1: Static Syntax Analysis');
try {
  execSync('npm run lint', { stdio: 'inherit' });
  console.log('✓ Syntax analysis passed\n');
} catch (err) {
  console.error('✗ Syntax analysis failed');
  process.exit(1);
}

// 2. JSON Schema & Locales Parse Check
console.log('▶ Step 2: JSON Schema & Locales Parse Check');
const jsonFiles = [
  'manifest.json',
  'package.json',
  'metadata.json',
  '_locales/en/messages.json',
  '_locales/de/messages.json',
  '_locales/ja/messages.json'
];
for (const f of jsonFiles) {
  if (fs.existsSync(f)) {
    try {
      JSON.parse(fs.readFileSync(f, 'utf8'));
      console.log(`✓ Valid JSON: ${f}`);
    } catch (err) {
      console.error(`✗ Invalid JSON in ${f}:`, err.message);
      process.exit(1);
    }
  } else {
    console.error(`✗ Missing expected JSON file: ${f}`);
    process.exit(1);
  }
}
console.log('');

// 3. Unit & Regression Test Suite
console.log('▶ Step 3: Unit & Regression Test Suite');
try {
  execSync('npm test', { stdio: 'inherit' });
  console.log('✓ Test suite passed\n');
} catch (err) {
  console.error('✗ Test suite failed');
  process.exit(1);
}

// 4. Manifest V3 Compliance Audit
console.log('▶ Step 4: Chrome Manifest V3 Compliance Audit');
try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  if (manifest.manifest_version !== 3) {
    throw new Error('Manifest version must be 3, found: ' + manifest.manifest_version);
  }

  const swPath = manifest.background?.service_worker;
  if (!swPath || !fs.existsSync(swPath)) {
    throw new Error('Background service worker not found at: ' + swPath);
  }

  const spPath = manifest.side_panel?.default_path;
  if (!spPath || !fs.existsSync(spPath)) {
    throw new Error('Side panel path not found at: ' + spPath);
  }

  const optPath = manifest.options_ui?.page;
  if (!optPath || !fs.existsSync(optPath)) {
    throw new Error('Options page not found at: ' + optPath);
  }

  const iconSizes = [16, 32, 48, 128];
  for (const size of iconSizes) {
    const iconPath = manifest.icons?.[size];
    if (!iconPath || !fs.existsSync(iconPath)) {
      throw new Error('Icon size ' + size + ' not found at: ' + iconPath);
    }
  }

  const csp = manifest.content_security_policy?.extension_pages;
  if (!csp || csp.includes('unsafe-eval')) {
    throw new Error('CSP violation: unsafe-eval is forbidden in MV3 production: ' + csp);
  }

  console.log('✓ Manifest V3 integrity check passed successfully.\n');
} catch (err) {
  console.error('✗ Manifest V3 compliance audit failed:', err.message);
  process.exit(1);
}

// 5. Extension Distribution Artifact Build
console.log('▶ Step 5: Packaging Extension Distribution Artifact');
try {
  fs.mkdirSync('dist', { recursive: true });
  const zipPath = path.resolve('dist/aether-extension.zip');

  let packaged = false;
  try {
    execSync('which zip', { stdio: 'ignore' });
    execSync(
      'zip -r dist/aether-extension.zip manifest.json _locales background content icons lib offscreen options sidepanel -x "*.DS_Store" "*__tests__*"',
      { stdio: 'inherit' }
    );
    packaged = true;
  } catch {
    // Fall back to python3 zipfile
    const pyCmd = `python3 -c "import zipfile, os
with zipfile.ZipFile('dist/aether-extension.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for base in ['manifest.json', '_locales', 'background', 'content', 'icons', 'lib', 'offscreen', 'options', 'sidepanel']:
        if os.path.isfile(base):
            z.write(base)
        else:
            for root, dirs, files in os.walk(base):
                for f in files:
                    if '.DS_Store' not in f and '__tests__' not in root:
                        fp = os.path.join(root, f)
                        z.write(fp)
"`;
    execSync(pyCmd, { stdio: 'inherit' });
    packaged = true;
  }

  if (fs.existsSync(zipPath)) {
    const stats = fs.statSync(zipPath);
    console.log(`✓ Zip bundle created: dist/aether-extension.zip (${(stats.size / 1024).toFixed(1)} KB)\n`);
  } else {
    throw new Error('dist/aether-extension.zip was not generated');
  }
} catch (err) {
  console.error('✗ Extension artifact packaging failed:', err.message);
  process.exit(1);
}

console.log('==============================================');
console.log(' CI Pipeline completed successfully!');
console.log('==============================================');
