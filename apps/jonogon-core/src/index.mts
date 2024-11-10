import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import express from 'express';
import {env} from './env.mjs';
import {httpContextCreatorFactory} from './api/trpc/context.mjs';
import {registerHTTPRoutes} from './api/http/index.mjs';
import {registerWSHandlers} from './api/websocket/index.mjs';
import {logger} from './logger.mjs';
import {createServices} from './services.mjs';
import cors from 'cors';
import {initQueues} from './api/queues/index.mjs';
import {processMilestoneDetectionQueue} from './services/queues/milestoneDetectionQueue.mjs';
import {processNotificationsSchedulerQueue} from './services/queues/notificationsSchedulerQueue.mjs';
import {processSmsNotificationDispatchQueue} from './services/queues/smsNotificationDispatchQueue.mjs';

const services = await createServices();

const expressApp = express();

expressApp.use(
    cors({
        origin: env.NODE_ENV === 'development' ? '*' : 'https://jonogon.org',
    }),
);

// separate HTTP server instance to share
// server instance between express and ws server
const server = createServer(expressApp);

const createHTTPContext = await httpContextCreatorFactory(services);

const wsServer = new WebSocketServer({
    server: server,
    path: '/ws',
});

logger.debug('registering http routes');
await registerHTTPRoutes(expressApp, createHTTPContext);

logger.debug('attaching ws handlers');
await registerWSHandlers(wsServer, createHTTPContext);

server.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`🚂 express: listening on http://0.0.0.0:${env.PORT}/`, {
        port: env.PORT,
    });
});

// QUEUES
await initQueues();

processMilestoneDetectionQueue(services);
processNotificationsSchedulerQueue(services);
processSmsNotificationDispatchQueue(services);

export {TAppRouter} from './api/trpc/routers/index.mjs';
