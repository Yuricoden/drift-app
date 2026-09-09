import express from 'express';
import { createApi } from './app';

const app = express();
app.disable('x-powered-by');
app.use('/api', createApi());

export default app;
