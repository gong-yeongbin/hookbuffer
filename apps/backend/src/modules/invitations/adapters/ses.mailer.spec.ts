import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { mockClient } from 'aws-sdk-client-mock';
import { SesMailer } from './ses.mailer';

// 실제 SES를 부르지 않고 "맞는 값으로 SendEmail을 호출했는가"만 본다. 근거는 context-notes.md "초대" 절
describe('SesMailer', () => {
	const ses = mockClient(SESv2Client);

	beforeEach(() => ses.reset());

	it('SendEmail을 발신 주소·수신자·제목·본문(UTF-8)으로 한 번 호출한다', async () => {
		ses.on(SendEmailCommand).resolves({ MessageId: 'm-1' });

		await new SesMailer(new SESv2Client({ region: 'ap-northeast-2' }), 'no-reply@hookbuffer.dev').send({
			to: 'kim@example.com',
			subject: '초대',
			text: 'https://app.test/invitations/tok',
		});

		const calls = ses.commandCalls(SendEmailCommand);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.args[0].input).toEqual({
			FromEmailAddress: 'no-reply@hookbuffer.dev',
			Destination: { ToAddresses: ['kim@example.com'] },
			Content: { Simple: { Subject: { Data: '초대', Charset: 'UTF-8' }, Body: { Text: { Data: 'https://app.test/invitations/tok', Charset: 'UTF-8' } } } },
		});
	});

	it('SES 오류는 그대로 던진다', async () => {
		ses.on(SendEmailCommand).rejects(new Error('MessageRejected'));
		const mailer = new SesMailer(new SESv2Client({ region: 'ap-northeast-2' }), 'no-reply@hookbuffer.dev');
		await expect(mailer.send({ to: 'kim@example.com', subject: 's', text: 't' })).rejects.toThrow('MessageRejected');
	});
});
