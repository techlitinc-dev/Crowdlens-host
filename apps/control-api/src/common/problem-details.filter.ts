import { ArgumentsHost, Catch, ExceptionFilter, Logger } from "@nestjs/common";
import { ZodError } from "zod";
import { ProblemDetailsError, problems } from "./problem-details.js";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger("http");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    const requestId = req.requestId ?? "unknown";

    if (exception instanceof ProblemDetailsError) {
      res.status(exception.status).json({ ...exception.toBody(), request_id: requestId });
      return;
    }
    if (exception instanceof ZodError) {
      const problem = problems.validation("Request validation failed", exception.issues);
      res.status(problem.status).json({ ...problem.toBody(), request_id: requestId });
      return;
    }
    const message = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(
      `unhandled: ${message} (${req.method} ${req.url}) ${exception instanceof Error ? exception.stack : ""}`,
    );
    const problem = problems.internal();
    res.status(problem.status).json({ ...problem.toBody(), request_id: requestId });
  }
}
