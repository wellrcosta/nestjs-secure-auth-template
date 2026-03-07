"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const nestjs_pino_1 = require("nestjs-pino");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: true });
    const logger = app.get(nestjs_pino_1.Logger);
    app.useLogger(logger);
    app.use((0, helmet_1.default)());
    app.use((0, cookie_parser_1.default)());
    const config = new swagger_1.DocumentBuilder()
        .setTitle('nestjs-secure-auth-template')
        .setDescription('Secure authentication template: JWT (access) + httpOnly refresh token rotation, sessions, audit logs, and Loki-friendly logging.')
        .setVersion('0.1.0')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('docs', app, document);
    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port);
}
bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map