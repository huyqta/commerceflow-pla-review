# infra/docker/Dockerfile
# Multi-Stage Build & Non-Root Production Dockerfile cho CommerceFlow Services
# Phục vụ Milestone M6 (CF-028 — Multi-stage Docker và health probes)
# Bảo vệ nguyên tắc: Zero Secret Leakage (Không copy .env), Non-Root User, Tối ưu Image Size và Tích hợp Health Probes

# ==============================================================================
# Giai đoạn 1: Dependencies Cache & Base
# ==============================================================================
FROM node:24-alpine AS base
WORKDIR /app
# Cài đặt công cụ curl và dumb-init cho health check và PID 1 signal handling
RUN apk add --no-cache curl dumb-init
ENV NODE_ENV=production

# ==============================================================================
# Giai đoạn 2: Builder & Compilation (Đóng gói mã nguồn & dependencies)
# ==============================================================================
FROM base AS builder
WORKDIR /app
ENV NODE_ENV=development

# Copy package descriptors để tận dụng Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev
COPY packages/ ./packages/
COPY apps/ ./apps/

# ==============================================================================
# Giai đoạn 3: Production Runtime (Tối giản, Bảo mật Non-Root & Healthcheck)
# ==============================================================================
FROM base AS runner
WORKDIR /app

# Thiết lập người dùng bảo mật không đặc quyền (Non-Root User)
RUN addgroup -g 1001 -S commerceflow && \
    adduser -u 1001 -S nodejs -G commerceflow

# Copy package.json, dependencies và mã nguồn
COPY --chown=nodejs:commerceflow package*.json ./
COPY --chown=nodejs:commerceflow --from=builder /app/node_modules ./node_modules
COPY --chown=nodejs:commerceflow apps/ ./apps/
COPY --chown=nodejs:commerceflow packages/ ./packages/

# Quy tắc bảo mật cốt lõi: Tuyệt đối KHÔNG copy file .env chứa secrets
# Đảm bảo các file nhạy cảm thuộc về non-root user
USER nodejs

# Cổng mặc định
EXPOSE 3000

# Tích hợp Healthcheck Probe (Docker/Compose Level)
# Phân biệt:
# - Liveness: Container tiến trình Node.js còn phản hồi socket HTTP không
# - Readiness: Endpoint /health/ready sẵn sàng nhận traffic (database & dependencies đã kết nối)
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health/liveness || exit 1

# Sử dụng dumb-init để xử lý signals SIGTERM / SIGINT chuẩn xác trong Kubernetes và Docker
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Lệnh khởi chạy mặc định
CMD ["node", "--experimental-strip-types", "apps/api-gateway/src/main.ts"]

