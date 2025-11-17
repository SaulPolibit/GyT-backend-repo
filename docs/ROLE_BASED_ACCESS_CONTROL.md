# Role-Based Access Control (RBAC) Documentation

## Role Definitions

The application uses a numeric role system:

| Role | Value | Description | Access Level |
|------|-------|-------------|--------------|
| **Root** | 0 | Super admin | Can see and edit ALL items |
| **Admin** | 1 | Fund manager | Can only see and edit items they created |
| **Investor** | 2 | Limited partner (LP) | No access to investment-manager, only lp-portal |

## Implementation

### 1. User Context

The `UserContext` has been updated to include role information and helper functions:

```typescript
import { useUser } from '@/contexts/UserContext'

function MyComponent() {
  const { userData, isRoot, isAdmin, isInvestor, canAccessInvestmentManager } = useUser()

  // Check user role
  if (isRoot()) {
    // User is root
  }

  if (isAdmin()) {
    // User is admin
  }

  if (isInvestor()) {
    // User is investor
  }

  // Check if can access investment manager pages
  if (canAccessInvestmentManager()) {
    // User is root or admin
  }
}
```

### 2. Route Protection

A `RouteGuard` component automatically:
- Redirects **investors** (role 2) from `/investment-manager/*` to `/lp-portal`
- Redirects unauthenticated users to `/sign-in`

The RouteGuard is already integrated in the root layout.

### 3. Data Filtering

Use the utility functions from `@/lib/role-utils` to filter data based on user role:

```typescript
import { filterByRole, canEdit, canDelete, canCreate } from '@/lib/role-utils'
import { useUser } from '@/contexts/UserContext'

function InvestorsPage() {
  const { userData } = useUser()
  const [allInvestors, setAllInvestors] = useState([])

  useEffect(() => {
    // Fetch all investors from API
    const response = await fetch('/api/investors')
    const data = await response.json()

    // Filter based on user role
    // Root sees all, Admin sees only their own
    const filteredInvestors = filterByRole(
      data,
      userData.role,
      userData.id
    )

    setAllInvestors(filteredInvestors)
  }, [])

  // Check if user can create new investors
  const canCreateInvestor = canCreate(userData.role)

  return (
    <div>
      {canCreateInvestor && (
        <Button>Create New Investor</Button>
      )}

      {allInvestors.map(investor => (
        <div key={investor.id}>
          {investor.name}

          {/* Show edit button only if user can edit */}
          {canEdit(investor, userData.role, userData.id) && (
            <Button>Edit</Button>
          )}

          {/* Show delete button only if user can delete */}
          {canDelete(investor, userData.role, userData.id) && (
            <Button>Delete</Button>
          )}
        </div>
      ))}
    </div>
  )
}
```

### 4. Backend API Filtering

**IMPORTANT:** While frontend filtering provides a good UX, you **MUST** also implement role-based filtering on the backend API.

#### For Root Users (role = 0):
Return all items without filtering.

#### For Admin Users (role = 1):
Filter items where `created_by` or `user_id` matches the authenticated user's ID.

**Example SQL:**
```sql
-- Root user (role = 0)
SELECT * FROM structures;

-- Admin user (role = 1)
SELECT * FROM structures
WHERE created_by = $1;  -- $1 = authenticated user's ID
```

**Example Express.js:**
```javascript
router.get('/api/structures', authenticateToken, async (req, res) => {
  const userId = req.user.id
  const userRole = req.user.role

  let query
  let params

  if (userRole === 0) {
    // Root: get all structures
    query = 'SELECT * FROM structures'
    params = []
  } else if (userRole === 1) {
    // Admin: get only user's structures
    query = 'SELECT * FROM structures WHERE created_by = $1'
    params = [userId]
  } else {
    // Investor: should not access this endpoint
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    })
  }

  const result = await pool.query(query, params)
  res.json({
    success: true,
    data: result.rows
  })
})
```

### 5. API Endpoints That Need Role Filtering

The following endpoints should implement role-based filtering:

- `GET /api/structures` - Filter by `created_by`
- `GET /api/investors` - Filter by `created_by` or `user_id`
- `GET /api/investments` - Filter by creator
- `GET /api/documents/all` - Filter by uploader
- `GET /api/capital-calls` - Filter by creator
- `GET /api/conversations` - Already filtered by participant

### 6. Field Names to Check

Different tables might use different field names for the creator. Check these fields:

- `created_by`
- `createdBy`
- `user_id`
- `userId`

The `filterByRole` utility function checks all these variants automatically.

### 7. Session Data Structure

The user session stored in `localStorage` under `polibit_session` should include:

```json
{
  "token": "jwt-token-here",
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": 1,
    "appLanguage": "en",
    "profileImage": "url-to-image"
  }
}
```

### 8. Testing

**Test as Root (role = 0):**
1. Create investors/structures as User A
2. Login as Root user
3. Should see ALL items from all users

**Test as Admin (role = 1):**
1. Create investors/structures as User A
2. Create investors/structures as User B
3. Login as User A
4. Should only see items created by User A

**Test as Investor (role = 2):**
1. Login as investor
2. Should be automatically redirected from `/investment-manager` to `/lp-portal`
3. Should not see admin features

## Security Checklist

- ✅ Route protection implemented (RouteGuard)
- ✅ Frontend data filtering implemented (filterByRole)
- ✅ Helper functions for edit/delete permissions
- ⚠️ **REQUIRED:** Backend API filtering must be implemented
- ⚠️ **REQUIRED:** Backend validation for all mutations (create, update, delete)
- ⚠️ **REQUIRED:** Investors should receive 403 Forbidden on admin endpoints

## Common Patterns

### Hide UI Elements Based on Role

```typescript
const { isRoot, isAdmin } = useUser()

return (
  <div>
    {(isRoot() || isAdmin()) && (
      <Button>Admin Only Feature</Button>
    )}

    {isRoot() && (
      <Button>Root Only Feature</Button>
    )}
  </div>
)
```

### Filter Data in useEffect

```typescript
useEffect(() => {
  async function loadData() {
    const response = await fetch('/api/items')
    const data = await response.json()

    // Filter based on role
    const filtered = filterByRole(data, userData.role, userData.id)
    setItems(filtered)
  }

  loadData()
}, [userData.role, userData.id])
```

### Conditional Navigation

```typescript
const { canAccessInvestmentManager } = useUser()

function handleClick() {
  if (canAccessInvestmentManager()) {
    router.push('/investment-manager')
  } else {
    router.push('/lp-portal')
  }
}
```

## Migration Guide for Existing Pages

For each page that displays lists of items:

1. Import the utilities:
   ```typescript
   import { filterByRole } from '@/lib/role-utils'
   import { useUser } from '@/contexts/UserContext'
   ```

2. Get user data:
   ```typescript
   const { userData } = useUser()
   ```

3. Filter the data after fetching:
   ```typescript
   const filtered = filterByRole(allItems, userData.role, userData.id)
   ```

4. Hide create/edit/delete buttons based on permissions:
   ```typescript
   {canCreate(userData.role) && <Button>Create</Button>}
   {canEdit(item, userData.role, userData.id) && <Button>Edit</Button>}
   {canDelete(item, userData.role, userData.id) && <Button>Delete</Button>}
   ```
