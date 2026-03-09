import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // https://www.prisma.io/docs/orm/reference/error-reference
    switch (exception.code) {
      case 'P2002': {
        // Unique constraint failed
        return res.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: 'Resource already exists',
          error: 'Conflict',
          meta: exception.meta,
        });
      }

      case 'P2025': {
        // Record not found
        return res.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Resource not found',
          error: 'Not Found',
        });
      }

      default: {
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          error: 'Internal Server Error',
        });
      }
    }
  }
}
