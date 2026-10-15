import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { reportsRouter } from './routes/reports.js';
import { fraudRouter } from './routes/fraud.js';
import { thanasRouter } from './routes/thanas.js';
import { adminRouter } from './routes/admin.js';
import { geoRouter } from './routes/geo.js';
import { teamsRouter } from './routes/teams.js';
import { sosRouter } from './routes/sos.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'prohori-api', time: new Date().toISOString() });
});

app.use('/api/reports', reportsRouter);
app.use('/api/fraud-numbers', fraudRouter);
app.use('/api/thanas', thanasRouter);
app.use('/api/admin/reports', adminRouter);
app.use('/api/geo', geoRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/sos', sosRouter);

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
