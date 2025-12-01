-- Supabase Database Schema
-- Run this SQL in your Supabase SQL Editor to create the required tables

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) DEFAULT '',
  app_language VARCHAR(10) DEFAULT 'en' CHECK (app_language IN ('en', 'es', 'fr', 'de', 'pt', 'it')),
  profile_image TEXT,
  role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator')),
  is_active BOOLEAN DEFAULT true,
  is_email_verified BOOLEAN DEFAULT false,
  last_login TIMESTAMP,
  password_reset_token TEXT,
  password_reset_expires TIMESTAMP,
  email_verification_token TEXT,
  email_verification_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- =============================================
-- REFRESH TOKENS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- =============================================
-- COMPANIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  firm_name VARCHAR(255) DEFAULT '',
  firm_logo TEXT,
  firm_email VARCHAR(255) DEFAULT '',
  firm_phone VARCHAR(50) DEFAULT '',
  website_url TEXT DEFAULT '',
  address TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_companies_firm_email ON companies(firm_email);

-- =============================================
-- NOTIFICATION SETTINGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN DEFAULT false,
  portfolio_notifications BOOLEAN DEFAULT false,
  report_notifications BOOLEAN DEFAULT false,
  investor_activity_notifications BOOLEAN DEFAULT false,
  system_update_notifications BOOLEAN DEFAULT false,
  marketing_email_notifications BOOLEAN DEFAULT false,
  push_notifications BOOLEAN DEFAULT false,
  sms_notifications BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_notification_settings_user_id ON notification_settings(user_id);

-- =============================================
-- SMART CONTRACTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS smart_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  compliance_registry_address VARCHAR(255) NOT NULL,
  contract_address VARCHAR(255) NOT NULL UNIQUE,
  factory_address VARCHAR(255) NOT NULL,
  identity_registry_address VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  max_tokens BIGINT NOT NULL CHECK (max_tokens >= 0),
  minted_tokens VARCHAR(255) DEFAULT '0',
  project_name VARCHAR(255) NOT NULL,
  token_name VARCHAR(255) NOT NULL,
  token_symbol VARCHAR(50) NOT NULL,
  token_value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_smart_contracts_project_id ON smart_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_smart_contracts_address ON smart_contracts(contract_address);
CREATE INDEX IF NOT EXISTS idx_smart_contracts_company ON smart_contracts(company);
CREATE INDEX IF NOT EXISTS idx_smart_contracts_token_symbol ON smart_contracts(token_symbol);

-- =============================================
-- PROJECTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  image TEXT,
  anual_rate DECIMAL(5,2) NOT NULL CHECK (anual_rate >= 0 AND anual_rate <= 100),
  estimate_gain DECIMAL(15,2) NOT NULL CHECK (estimate_gain >= 0),
  minimum_ticket_usd DECIMAL(15,2) NOT NULL CHECK (minimum_ticket_usd >= 0),
  minumum_ticket_mxn DECIMAL(15,2) NOT NULL CHECK (minumum_ticket_mxn >= 0),
  available BOOLEAN DEFAULT false,
  paused BOOLEAN DEFAULT false,
  user_creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_user_creator_id ON projects(user_creator_id);
CREATE INDEX IF NOT EXISTS idx_projects_available ON projects(available);
CREATE INDEX IF NOT EXISTS idx_projects_paused ON projects(paused);
CREATE INDEX IF NOT EXISTS idx_projects_available_paused ON projects(available, paused);

-- =============================================
-- SUBSCRIPTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  fund_id VARCHAR(255) NOT NULL,
  requested_amount VARCHAR(255) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_structure_id ON subscriptions(structure_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_fund_id ON subscriptions(fund_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_id ON subscriptions(payment_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- =============================================
-- TRIGGERS FOR UPDATED_AT
-- =============================================
-- Create a function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply the trigger to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON notification_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_smart_contracts_updated_at BEFORE UPDATE ON smart_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- ROW LEVEL SECURITY (RLS) - Optional but recommended
-- =============================================
-- Enable RLS on tables (uncomment if using Supabase Auth)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE smart_contracts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Example RLS policies (customize based on your needs)
-- CREATE POLICY "Users can view own data" ON users
--   FOR SELECT USING (auth.uid() = id);

-- CREATE POLICY "Users can update own data" ON users
--   FOR UPDATE USING (auth.uid() = id);
