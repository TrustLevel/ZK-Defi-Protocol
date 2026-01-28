#!/usr/bin/env -S deno run --allow-all
/**
 * V3 Backend API Server
 *
 * Provides endpoints for anonymous borrowing and repayment.
 * Backend verifies ZK proofs and signs transactions with admin key.
 *
 * Endpoints:
 * - POST /api/v3/borrow - Anonymous borrow request
 * - POST /api/v3/repay - Anonymous repayment
 * - GET /api/health - Health check
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { API_PORT, API_HOST, API_CORS_ORIGIN } from "../lib/config.ts";

// Import handlers
import { handleBorrowRequest } from "./services/borrow.ts";
import { handleRepayRequest } from "./services/repay.ts";

// ============================================
// CORS MIDDLEWARE
// ============================================

function corsHeaders(): Headers {
    return new Headers({
        "Access-Control-Allow-Origin": API_CORS_ORIGIN,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    });
}

// ============================================
// REQUEST HANDLERS
// ============================================

async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: corsHeaders(),
        });
    }

    // Health check
    if (path === "/api/health" && req.method === "GET") {
        return new Response(
            JSON.stringify({
                status: "ok",
                version: "v3",
                timestamp: Date.now(),
            }),
            {
                status: 200,
                headers: corsHeaders(),
            },
        );
    }

    // Borrow endpoint
    if (path === "/api/v3/borrow" && req.method === "POST") {
        try {
            const body = await req.json();
            const result = await handleBorrowRequest(body);

            return new Response(JSON.stringify(result), {
                status: 200,
                headers: corsHeaders(),
            });
        } catch (error: any) {
            console.error("Borrow request error:", error);

            return new Response(
                JSON.stringify({
                    error: error.message || "Internal server error",
                    details: error.stack,
                }),
                {
                    status: 500,
                    headers: corsHeaders(),
                },
            );
        }
    }

    // Repay endpoint
    if (path === "/api/v3/repay" && req.method === "POST") {
        try {
            const body = await req.json();
            const result = await handleRepayRequest(body);

            return new Response(JSON.stringify(result), {
                status: 200,
                headers: corsHeaders(),
            });
        } catch (error: any) {
            console.error("Repay request error:", error);

            return new Response(
                JSON.stringify({
                    error: error.message || "Internal server error",
                    details: error.stack,
                }),
                {
                    status: 500,
                    headers: corsHeaders(),
                },
            );
        }
    }

    // 404 for unknown routes
    return new Response(
        JSON.stringify({
            error: "Not found",
            path: path,
        }),
        {
            status: 404,
            headers: corsHeaders(),
        },
    );
}

// ============================================
// SERVER START
// ============================================

async function startServer() {
    console.log("═══════════════════════════════════════════════════════");
    console.log("🚀 V3 Backend API Server Starting");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Configuration:");
    console.log(`   Host: ${API_HOST}`);
    console.log(`   Port: ${API_PORT}`);
    console.log(`   CORS Origin: ${API_CORS_ORIGIN}\n`);

    console.log("📡 Available Endpoints:");
    console.log(`   GET  /api/health          - Health check`);
    console.log(`   POST /api/v3/borrow       - Anonymous borrow`);
    console.log(`   POST /api/v3/repay        - Anonymous repay\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log(`✅ Server listening on http://${API_HOST}:${API_PORT}`);
    console.log("═══════════════════════════════════════════════════════\n");

    await serve(handler, { hostname: API_HOST, port: API_PORT });
}

// Run server
if (import.meta.main) {
    startServer().catch((error) => {
        console.error("❌ Server error:", error);
        Deno.exit(1);
    });
}
