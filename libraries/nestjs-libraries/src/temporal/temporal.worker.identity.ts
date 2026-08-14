import { hostname } from 'node:os';

export const getTemporalWorkerIdentity = () =>
  `${process.pid}@${hostname()}`;
