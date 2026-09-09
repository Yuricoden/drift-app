import express from 'express';
import { createApi } from './app.js';

const app = express();
app.disable('x-powered-by');
app.use('/api', createApi());

export default app;
