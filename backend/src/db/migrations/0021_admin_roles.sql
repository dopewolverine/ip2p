-- P2 §8.2 - "Only the Owner role can initiate this [arbitration].
-- Staff may recommend an outcome; they cannot execute one." Minimal
-- role column rather than a separate roles table, since P0 never
-- defined any role concept and P2 only needs to distinguish these two
-- from an ordinary user.
ALTER TABLE users ADD COLUMN role text NULL; -- 'owner' | 'staff' | NULL (ordinary user)
