import swaggerAutogen from 'swagger-autogen';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const doc = {
    info: {
        title: 'My API',
        description: 'Description'
    },
    host: (process.env.BASE_URL as string)?.split('//')[1] || 'localhost:8080',
    schemes: ['http', 'https'],
    securityDefinitions: {
        bearerAuth: {
            type: 'apiKey',
            scheme: 'bearer',
            in: 'header',
            name: 'Authorization',
            bearerFormat: 'JWT'
        }
    }
};

// Determine if running from dist or source
const isProduction = __dirname.includes('dist');
const ext = isProduction ? '.js' : '.ts';
const outputFile = path.join(__dirname, 'swagger-output.json');
const routes = [path.join(__dirname, `server${ext}`)];

/* NOTE: If you are using the express Router, you must pass in the 'routes' only the 
root file where the route starts, such as index.js, app.js, routes.js, etc ... */

export const generateSwagger = async () => {
    await swaggerAutogen(outputFile, routes, doc);
};