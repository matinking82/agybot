import express from 'express';
import cors from 'cors';
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import { generateSwagger } from './swagger';
import { initializeAdmin } from './services/adminDbServices';

import adminAuthRouter from './routers/adminAuthRouter';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/admin', adminAuthRouter);

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.get('/image/:filename', (req, res) => {
    // #swagger.tags = ['Image']
    // #swagger.description = 'Get image by filename'

    //get image from /images folder and send it as response

    let filename = req.params.filename;

    res.sendFile(path.join(__dirname, 'images', filename));

    return;
});

(async () => {
    await initializeAdmin();
    await generateSwagger();
    const swaggerOutputPath = path.join(__dirname, 'swagger-output.json');
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerOutputPath, 'utf8'));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
})()

export default app;
