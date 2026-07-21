/**
 * Environment validation for production readiness.
 * --strict: exit 1 on missing var (for CI/pre-deploy)
 */

const REQUIRED_VARS = [
  { key: 'DATABASE_URL', desc: 'PostgreSQL connection string' },
  { key: 'APP_ORIGIN', desc: 'Frontend origin URL' },
  { key: 'ANTHROPIC_API_KEY', desc: 'Anthropic API key' },
  { key: 'OPENAI_API_KEY', desc: 'OpenAI API key (embeddings)' },
];

const OPTIONAL_VARS = [
  { key: 'PORT_SERVER', desc: 'Server port (default: 3001)' },
  { key: 'PORT_WEB', desc: 'Web port (default: 3000)' },
  { key: 'UPLOADS_DIR', desc: 'File uploads directory' },
];

const strict = process.argv.includes('--strict');
let missing = 0;

console.log('\nBramhaV2 Environment Check\n');

for (const { key, desc } of REQUIRED_VARS) {
  const val = process.env[key];
  if (!val) {
    console.error(`  MISSING  ${key.padEnd(24)} — ${desc}`);
    missing++;
  } else {
    const preview = key.includes('KEY') || key.includes('URL') ? val.slice(0, 8) + '...' : val;
    console.log(`  OK       ${key.padEnd(24)} = ${preview}`);
  }
}

console.log('');
for (const { key, desc } of OPTIONAL_VARS) {
  const val = process.env[key];
  console.log(`  ${val ? 'OK   ' : 'UNSET'} ${key.padEnd(24)} — ${desc}`);
}

console.log('');
if (missing > 0) {
  console.error(`${missing} required variable(s) missing.\n`);
  if (strict) process.exit(1);
} else {
  console.log('All required environment variables are set.\n');
}
