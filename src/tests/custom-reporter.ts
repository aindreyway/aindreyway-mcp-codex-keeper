import fs from 'fs';
import path from 'path';
import type { Reporter, Test, TestResult } from '@jest/reporters';

class CustomReporter implements Reporter {
  private results: string[] = [];
  private startTime: number = Date.now();
  private reportPath: string;

  constructor() {
    this.reportPath = path.join(process.cwd(), 'TESTREPORT.md');
  }

  onRunStart() {
    this.startTime = Date.now();
    this.results = ['# Test Report\n\n'];
    this.writeReport();
    // Выводим только начальное сообщение
    console.log('\nRunning tests...');
  }

  onTestResult(_test: Test, testResult: TestResult) {
    const { testResults, numFailingTests, numPassingTests, numPendingTests } = testResult;

    // Добавляем в отчет подробную информацию
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

  onRunComplete(_contexts: Set<any>, results: any) {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);

    // Добавляем итоговую информацию в отчет
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

    // Выводим в консоль только краткую информацию
    console.log('\nTest Results:');
    console.log(`✅ Passed: ${results.numPassedTests}`);
    if (results.numFailedTests > 0) {
      console.log(`❌ Failed: ${results.numFailedTests}`);
    }
    if (results.numPendingTests > 0) {
      console.log(`⏳ Pending: ${results.numPendingTests}`);
    }
    console.log(`\nTime: ${duration}s`);
    console.log(`\nDetailed report: ${this.reportPath}`);
    console.log(`HTML report: ${path.join(process.cwd(), 'test-report/index.html')}\n`);
  }

  private writeReport() {
    fs.writeFileSync(this.reportPath, this.results.join('\n'));
  }
}

export default CustomReporter;
