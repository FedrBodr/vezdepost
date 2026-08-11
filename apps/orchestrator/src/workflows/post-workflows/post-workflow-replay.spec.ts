import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowVersions = ['1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5'];
const patchId = 'start-personal-streak-reminders-after-published-v1';

describe('post workflow replay compatibility', () => {
  it.each(workflowVersions)(
    'guards the reminder command in workflow v%s with the stable patch marker',
    (version) => {
      const source = readFileSync(
        join(__dirname, `post.workflow.v${version}.ts`),
        'utf8'
      );

      expect(source).toContain('patched,');
      expect(source).toContain(`patched('${patchId}')`);
      expect(source).toMatch(
        /if \(patched\('[^']+'\)\) \{\s*try \{\s*await startPersonalStreakReminders/
      );
    }
  );
});
