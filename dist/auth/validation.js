/** Form-level validation for the password sign-in user name. */
export function validateUserName(value) {
    const userName = value.trim();
    if (!userName)
        return 'Enter your user name.';
    if (userName.length > 64)
        return 'User names are 64 characters or fewer.';
    if (!/^[A-Za-z0-9._@-]+$/.test(userName)) {
        return 'Use letters, digits, dots, dashes, underscores, or @.';
    }
    return '';
}
//# sourceMappingURL=validation.js.map