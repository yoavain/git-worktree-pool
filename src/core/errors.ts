export class WtpError extends Error {
    constructor(message: string, readonly exitCode: 1 | 2 | 3 = 1) {
        super(message);
        this.name = new.target.name;
    }
}

export class UserError extends WtpError {
    constructor(message: string) {
        super(message, 1);
    }
}

export class ContextError extends WtpError {
    constructor(message: string) {
        super(message, 2);
    }
}

export class GitError extends WtpError {
    constructor(readonly args: string[], readonly code: number | null, readonly stderr: string) {
        super(`git ${args.join(" ")} failed: ${stderr.trim() || `exit code ${code}`}`, 3);
    }
}

export class BranchInUseError extends UserError {
    constructor(readonly branch: string, readonly index: number | null, readonly path: string) {
        super(index === null
            ? `${branch} is checked out in ${path}`
            : `${branch} is already in slot ${index}`);
    }
}
