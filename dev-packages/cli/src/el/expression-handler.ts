import * as traverse from 'traverse';
import { JexlEngineProvider } from './jexl-engine-provider';
import { ExpressionCompiler } from './expression-compiler';
import { ExpressionContext } from './expression-protocol';

export class ExpressionHandler {

    protected readonly jexlEngineProvider = new JexlEngineProvider();

    protected readonly expressionCompiler = new ExpressionCompiler();

    constructor(protected ctx: ExpressionContext) {

    }

    handle() {
        const self = this;
        traverse(this.ctx).forEach(function (value: any) {
            if (typeof value === 'string') {
                this.update(self.evalSync(value, self.ctx));
            }
        });
    }

    evalSync(text: string, ctx: ExpressionContext): any {
        const sections = this.expressionCompiler.compileSections(text);
        if (sections.length > 0) {
            if (this.hasExpression(sections)) {
                if (sections.length === 1) {
                    return sections[0].evalSync(ctx);
                }
                const result: string[] = [];
                for (const section of sections) {
                    if (typeof section === 'string') {
                        result.push(section);
                    } else {
                        result.push(section.evalSync(ctx));
                    }
                }
                return result.join('');
            }
        }
        return text;
    }

    protected hasExpression(sections: any[]) {
        for (const section of sections) {
            if (typeof section !== 'string') {
                return true;
            }
        }
        return false;
    }

}