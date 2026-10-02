import './lib/asyncErrors'; // must load before any route handles a request
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { pool } from './db/pool';
import { BadRequest } from './lib/params';
import { registerRouter } from './routes/register';
import { loginRouter } from './routes/login';
import { passwordResetRouter } from './routes/passwordReset';
import { kdfParamsRouter } from './routes/kdfParams';
import { recoverRouter } from './routes/recover';
import { totpRouter } from './routes/totp';
import { accountRouter } from './routes/account';
import { meRouter } from './routes/me';
import { walletRouter } from './routes/wallet';
import { escrowRouter } from './routes/escrow';
import { adminRouter } from './routes/admin';
import { offersRouter } from './routes/offers';
import { tradesRouter } from './routes/trades';
import { referenceRouter } from './routes/reference';
import { chatRouter } from './routes/chat';
import { disputesRouter } from './routes/disputes';
import { notificationsRouter } from './routes/notifications';
import { ticketsRouter } from './routes/tickets';
import { reputationRouter } from './routes/reputation';
import { startNotificationDeliveryWorker } from './lib/notificationDelivery';
import { startDisputeEscalationWorker } from './lib/disputeEscalation';
import { startTotpDisableSweep } from './lib/totpDisableSweep';
import { startAccountDeletionSweep } from './lib/accountDeletionSweep';
import { startDepositMonitor, startConfirmationSweep } from './lib/depositMonitor';
import { startEscrowFundingMonitor, startEscrowFundingSweep } from './escrow/fundingMonitor';
import { startBroadcastReconciler } from './escrow/releaseProposal';
import { startEscrowTimerWorker } from './escrow/timers';
import { startOfferAutoPauseWorker } from './marketplace/offerAutoPause';

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
// Continuing after an uncaught exception runs the process
// in an unknown state. Log and exit; the container restarts it
// (restart: unless-stopped), and timers catch up via the outage extension.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

const app = express();

// One reverse proxy (nginx) in front. If the backend is ever exposed
// directly, set this to false - otherwise X-Forwarded-For is trusted and
// per-IP rate limits can be bypassed.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', network: env.network, trading_open: env.tradingOpen, registration_open: env.registrationOpen });
  } catch {
    res.status(503).json({ status: 'db_unreachable' });
  }
});

app.use('/auth', registerRouter);
app.use('/auth', loginRouter);
app.use('/auth', passwordResetRouter);
app.use('/auth', kdfParamsRouter);
app.use('/auth', recoverRouter);
app.use('/auth', totpRouter);
app.use('/auth', accountRouter);
app.use('/auth', meRouter);
app.use('/', walletRouter);
app.use('/', escrowRouter);
app.use('/', adminRouter);
app.use('/', offersRouter);
app.use('/', tradesRouter);
app.use('/', referenceRouter);
app.use('/', chatRouter);
app.use('/', disputesRouter);
app.use('/', notificationsRouter);
app.use('/', ticketsRouter);
app.use('/', reputationRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found' });
});

// JSON errors instead of Express's default HTML page
// (which prints stack traces outside production) or a hung request.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof BadRequest) return res.status(400).json({ error: err.code });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  if (err?.code === '22P02') return res.status(400).json({ error: 'invalid_input' });
  console.error('[route error]', err);
  res.status(500).json({ error: 'internal_error' });
});

startTotpDisableSweep();
startAccountDeletionSweep();

startDepositMonitor().catch((err) => console.error('startDepositMonitor failed', err));
startConfirmationSweep();

startEscrowFundingMonitor().catch((err) => console.error('startEscrowFundingMonitor failed', err));
startEscrowFundingSweep();
startBroadcastReconciler();
startEscrowTimerWorker();

startOfferAutoPauseWorker();

startNotificationDeliveryWorker();
startDisputeEscalationWorker();

app.listen(env.port, () => {
  console.log(`iP2P backend listening on :${env.port} (${env.network}; trading ${env.tradingOpen ? 'OPEN' : 'closed'}; sign-ups ${env.registrationOpen ? 'open' : 'closed'})`);
});
