const fs = require('node:fs');
const path = require('node:path');
const consoleEntry = path.resolve(__dirname, '../../../console/src/redirect.cjs');
const standalone = process.argv.some(value => value === '--standalone' || value.startsWith('--self-test'));
if (!standalone && fs.existsSync(consoleEntry)) require(consoleEntry).redirect('sunaookami-shiroko');
else require('./runtime.cjs').createPetRuntime();
