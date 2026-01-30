/*
* Middleware for å hindre caching
*
*/
import { Request, Response, NextFunction } from "express";

// Middleware som setter headers for å hindre caching
export const noCache = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
};
