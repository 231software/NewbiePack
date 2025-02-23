export class CommandError extends Error {
    code:string|undefined
    constructor(message: string,code?:string) {
      super(message);
      //覆盖原Error的名称
      this.name = 'CommandParamError';
      this.code=code
      
      // If your target environment doesn't support Error.captureStackTrace,
      // you can use alternative methods to capture stack traces.
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, CommandError);
        }
    }
}
  