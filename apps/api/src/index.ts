import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { reportsRouter } from './routes/reports.js';
import { fraudRouter } from './routes/fraud.js';
import { thanasRouter } from './routes/thanas.js';
import { adminRouter } from './routes/admin.js';
import { adminOpsRouter } from './routes/adminOps.js';
import { adminUsersRouter } from './routes/adminUsers.js';
import { devicesRouter } from './routes/devices.js';
import { petitionsRouter } from './routes/petitions.js';
import { missingRouter } from './routes/missing.js';
import { statsRouter } from './routes/stats.js';
import { shareRouter } from './routes/share.js';
import { geoRouter } from './routes/geo.js';
import { teamsRouter } from './routes/teams.js';
import { sosRouter } from './routes/sos.js';
import { pushRouter } from './routes/push.js';
import { cronRouter } from './routes/cron.js';
import { hotspotsRouter } from './routes/hotspots.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'prohori-api', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/fraud-numbers', fraudRouter);
app.use('/api/thanas', thanasRouter);
app.use('/api/admin/reports', adminRouter);
app.use('/api/admin', adminOpsRouter);
app.use('/api/admin', adminUsersRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/petitions', petitionsRouter);
app.use('/api/missing', missingRouter);
app.use('/api/stats', statsRouter);
app.use('/share', shareRouter);
app.use('/api/geo', geoRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/sos', sosRouter);
app.use('/api/push', pushRouter);
app.use('/api/cron', cronRouter);
app.use('/api/hotspots', hotspotsRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' });
});

// Central error handler: zod/validation errors arrive with .status = 400.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { status?: number; message?: string; details?: unknown };
  const status = typeof e.status === 'number' ? e.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: e.message ?? 'internal error', details: e.details });
});

app.listen(PORT, () => {
  console.log(`prohori-api listening on http://localhost:${PORT}`);
});
