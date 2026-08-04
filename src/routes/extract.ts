import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { sniffMiddleware, uploadSingleFile } from "../middleware/upload.js";
import type { SniffedUpload } from "../middleware/upload.js";
import { NoObservationsFoundError } from "../errors.js";
import { logger } from "../logger.js";
import { ocrProvider } from "../ocr/index.js";
import { parseReport } from "../parsing/parser.js";
import { mapToObservation } from "../fhir/mapper.js";
import { buildBundle } from "../fhir/bundle.js";
import { reviewObservations } from "../validation/validator.js";

export const extractRouter: Router = Router();

extractRouter.post(
  "/extract",
  requireAuth,
  uploadSingleFile,
  sniffMiddleware,
  async (req, res) => {
    // A poll can run for minutes; if the client hangs up we should stop polling
    // rather than keep spending Datalab credits on a response nobody will read.
    //
    // This has to be res.on('close'), not req.on('close'): the request stream fires
    // 'close' as soon as the upload body has been fully read, which happens almost
    // immediately, long before this handler's async work is done — that is not a
    // disconnect signal. res's 'close' with writableEnded still false is the actual
    // "client went away before we finished" signal.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort(new Error("client disconnected before the response completed"));
      }
    });

    // sniffMiddleware always either sets this or forwards an error before this
    // handler runs — it can't be missing here.
    const file = req.sniffedFile as SniffedUpload;

    const ocrResult = await ocrProvider.extractMarkdown(file, controller.signal);
    const { observations: rawObservations, stats } = parseReport(ocrResult.markdown);

    // Counts only, never content: a report's text is PHI. Without this a
    // systematically empty parse is invisible in production.
    logger.info(
      {
        requestId: req.id,
        pageCount: ocrResult.pageCount,
        ...stats,
      },
      "extraction complete",
    );

    if (rawObservations.length === 0) {
      throw new NoObservationsFoundError();
    }

    const mapped = rawObservations.map(mapToObservation);
    const { needsReview } = reviewObservations(mapped);
    const bundle = buildBundle(mapped, needsReview);

    res.json(bundle);
  },
);
