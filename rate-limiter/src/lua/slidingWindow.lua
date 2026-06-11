-- slidingWindow.lua
-- Atomic sliding window rate limiter using Redis Sorted Sets (ZSET)
--
-- KEYS[1] = the rate limit key (e.g., rl:{tenantId}:ip:{ip})
-- ARGV[1] = now (current timestamp in ms)
-- ARGV[2] = window (window duration in ms)
-- ARGV[3] = maxReq (max requests allowed in window)
--
-- Returns: { allowed (1/0), remaining }

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local maxReq = tonumber(ARGV[3])

local windowStart = now - window

-- Step 1: Remove all entries outside the current window
redis.call("ZREMRANGEBYSCORE", key, 0, windowStart)

-- Step 2: Count remaining entries in the window
local count = redis.call("ZCARD", key)

if count < maxReq then
  -- Step 3: Add this request (score = timestamp, member = timestamp + random for uniqueness)
  local member = now .. ":" .. math.random(1, 1000000)
  redis.call("ZADD", key, now, member)

  -- Step 4: Set TTL so idle keys auto-expire
  redis.call("PEXPIRE", key, window)

  -- Return: allowed = 1, remaining = how many more requests are allowed
  return { 1, maxReq - count - 1 }
else
  -- Over limit: ensure TTL is still set
  redis.call("PEXPIRE", key, window)

  -- Return: allowed = 0, remaining = 0
  return { 0, 0 }
end
