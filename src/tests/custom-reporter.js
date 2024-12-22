import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CustomReporter {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
    this.reportPath = path.join(process.cwd(), 'TESTREPORT.md');
  }

  onRunStart() {
    this.startTime = Date.now();
    this.results = ['# Test Report\n\n'];
    this.writeReport();
  }

  onTestResult(_test, testResult) {
    const { testResults, numFailingTests, numPassingTests, numPendingTests } = testResult;

    this.results.push(`## ${path.relative(process.cwd(), testResult.testFilePath)}\n`);

    if (numFailingTests > 0) {
      this.results.push('\n### ❌ Failed Tests\n');
      testResults
        .filter(result => result.status === 'failed')
        .forEach(result => {
          this.results.push(`- ${result.fullName}`);
          this.results.push(`  \`\`\`\n  ${result.failureMessages.join('\n  ')}\n  \`\`\`\n`);
        });
    }

    if (numPassingTests > 0) {
      this.results.push('\n### ✅ Passed Tests\n');
      testResults
        .filter(result => result.status === 'passed')
        .forEach(result => {
          this.results.push(`- ${result.fullName}`);
        });
    }

    if (numPendingTests > 0) {
      this.results.push('\n### ⏳ Pending Tests\n');
      testResults
        .filter(result => result.status === 'pending')
        .forEach(result => {
          this.results.push(`- ${result.fullName}`);
        });
    }

    this.writeReport();
  }

  onRunComplete(_contexts, results) {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);

    this.results.push('\n## Summary\n');
    this.results.push(`- Duration: ${duration}s`);
    this.results.push(`- Total Suites: ${results.numTotalTestSuites}`);
    this.results.push(`- Failed Suites: ${results.numFailedTestSuites}`);
    this.results.push(`- Passed Suites: ${results.numPassedTestSuites}`);
    this.results.push(`- Total Tests: ${results.numTotalTests}`);
    this.results.push(`- Failed Tests: ${results.numFailedTests}`);
    this.results.push(`- Passed Tests: ${results.numPassedTests}`);
    this.results.push(`- Pending Tests: ${results.numPendingTests}`);
    this.results.push(`\nTimestamp: ${new Date().toISOString()}`);

    this.writeReport();
  }

  writeReport() {
    fs.writeFileSync(this.reportPath, this.results.join('\n'));
  }
}

export default CustomReporter;
