import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dialogArgs, readStderr } from './folderpick.mjs';

describe('readStderr', () => {
	it('drops CLIXML progress noise', () => {
		const progress =
			'#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN><MS><I64 N="SourceId">1</I64></MS></Obj></Objs>';
		assert.equal(readStderr(progress), '');
	});

	it('keeps the error records, decoded', () => {
		const error =
			'#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">Exception calling "Pick": &quot;Access denied&quot;_x000D__x000A_</S><S S="Error">At line:1 char:1_x000D__x000A_</S></Objs>';
		assert.equal(readStderr(error), 'Exception calling "Pick": "Access denied"\nAt line:1 char:1');
	});

	it('passes plain text through', () => {
		assert.equal(readStderr('  something broke \n'), 'something broke');
		assert.equal(readStderr(undefined), '');
	});
});

describe('dialogArgs', () => {
	it('hands PowerShell the script encoded, in a single-threaded apartment', () => {
		const args = dialogArgs('Write-Output 1');
		assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass']);
		assert.equal(args[5], '-EncodedCommand');
		assert.equal(Buffer.from(args[6], 'base64').toString('utf16le'), 'Write-Output 1');
	});
});
