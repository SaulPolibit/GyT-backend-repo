// config/database.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabase = null;
let supabaseRealtime = null; // Separate client for Realtime (uses ANON_KEY)

const connectDB = async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    // Use service role key for backend operations to bypass RLS
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials. Please check your .env file.');
    }

    // Create Supabase client
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false // Set to true if you need session persistence
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    // Test connection by querying the users table
    // This will work once the schema is created
    const { error } = await supabase.from('users').select('count').limit(0);

    // If the error is about the table not existing, user needs to run the schema
    if (error && error.message.includes('does not exist')) {
      console.log(`⚠️  Supabase connected, but tables not found.`);
      console.log(`📋 Please run the SQL schema from docs/supabase-schema.sql in your Supabase dashboard.`);
      console.log(`✅ Supabase client initialized: ${supabaseUrl}`);
      return supabase;
    }

    if (error) {
      throw error;
    }

    console.log(`✅ Supabase Connected: ${supabaseUrl}`);
    return supabase;

  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message);
    process.exit(1);
  }
};

// Get the Supabase client instance
// Auto-initialize for serverless environments (Vercel)
const getSupabase = () => {
  if (!supabase) {
    // Auto-initialize for serverless environments
    const supabaseUrl = process.env.SUPABASE_URL;
    // Use service role key for backend operations to bypass RLS
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseKey = serviceRoleKey || anonKey;

    // Debug logging to identify which key is being used
    const keyType = serviceRoleKey ? 'SERVICE_ROLE' : (anonKey ? 'ANON' : 'NONE');
    console.log(`[Supabase] Key type being used: ${keyType}`);
    console.log(`[Supabase] SERVICE_ROLE_KEY present: ${!!serviceRoleKey}`);
    console.log(`[Supabase] Key starts with: ${supabaseKey?.substring(0, 20)}...`);

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials. Please check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
    }

    console.log('🔄 Auto-initializing Supabase client for serverless environment...');

    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    console.log(`✅ Supabase client initialized: ${supabaseUrl}`);
  }
  return supabase;
};

// Get a Supabase client specifically for Realtime (uses ANON_KEY for WebSocket compatibility)
const getSupabaseRealtime = () => {
  if (!supabaseRealtime) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY for Realtime');
    }

    console.log('[Supabase Realtime] Creating Realtime client with ANON_KEY');

    supabaseRealtime = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    console.log(`[Supabase Realtime] Client initialized: ${supabaseUrl}`);
  }
  return supabaseRealtime;
};

module.exports = { connectDB, getSupabase, getSupabaseRealtime };