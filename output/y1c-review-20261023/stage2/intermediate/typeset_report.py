from pathlib import Path
import html
import json
import re

base = Path('D:/flowweb/output/y1c-review-20261023')
source = (base / 'stage1/final_draft.md').read_text(encoding='utf-8')
token_path = Path('C:/Users/link/.workbuddy-ai/plugins/cache/workbuddy-builtin/workbuddy-docx/5.8.4-wb.41366630.g73952edb.h4da087921e4a/skills/design-token/tokens/compiled/business-report.json')
bundle = json.loads(token_path.read_text(encoding='utf-8'))
variables = dict(bundle['css_variables'])
variables.update({
    '--typography-fontFamily-body': 'SimSun, 宋体, serif',
    '--typography-fontSize-body': '12pt',
    '--typography-fontSize-h2': '17pt',
    '--typography-fontSize-h3': '13pt',
    '--spacing-indent': '2em',
    '--spacing-block': '1em',
    '--spacing-section': '1.8em',
    '--page-content-width': '15.6cm',
    '--color-border': '#E0E0E0',
    '--color-muted': '#616161',
    '--radius-code': '3px',
    '--code-pad': '0.1em',
    '--fw-bold': '700',
    '--fs-body': 'var(--typography-fontSize-body)',
    '--ff-body': 'var(--typography-fontFamily-body)'
})
bundle['css_variables'] = variables
bundle['overrides_reason'] = 'Long Chinese engineering report: body SimSun 12pt, readable headings, first-line indent.'
(base / 'stage2/design_tokens.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')

def inline(text):
    stash = []
    def keep(value):
        stash.append(value)
        return f'ZZINLINE{len(stash)-1}ZZ'
    text = re.sub(r'`([^`]+)`', lambda m: keep('<code>' + html.escape(m.group(1)) + '</code>'), text)
    text = re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)', lambda m: keep(html.escape(m.group(1)) + '（' + html.escape(m.group(2)) + '）'), text)
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    for i, value in enumerate(stash):
        text = text.replace(f'ZZINLINE{i}ZZ', value)
    return text

blocks = []
paragraph = []
list_kind = None
heading_count = 0

def end_paragraph():
    if paragraph:
        blocks.append('<p>' + inline(' '.join(paragraph)) + '</p>')
        paragraph.clear()

def end_list():
    global list_kind
    if list_kind:
        blocks.append('</' + list_kind + '>')
        list_kind = None

for line in source.splitlines():
    if not line.strip():
        end_paragraph()
        end_list()
        continue
    match = re.match(r'^(#{1,3}) (.*)$', line)
    if match:
        end_paragraph()
        end_list()
        level = len(match.group(1))
        heading_count += 1
        blocks.append(f'<h{level} id="heading-{heading_count}">' + inline(match.group(2)) + f'</h{level}>')
        continue
    bullet = re.match(r'^- (.*)$', line)
    numbered = re.match(r'^\d+\. (.*)$', line)
    if bullet or numbered:
        end_paragraph()
        desired = 'ul' if bullet else 'ol'
        if list_kind != desired:
            end_list()
            blocks.append('<' + desired + '>')
            list_kind = desired
        blocks.append('<li>' + inline((bullet or numbered).group(1)) + '</li>')
        continue
    end_list()
    paragraph.append(line)
end_paragraph()
end_list()
intros = {
    '2. 先纠正方案基线': '先区分已完成能力与真正缺口，避免按旧行号重建已经存在的机制。',
    '4. 确定的目标架构': '以下设计将协作内容、业务事实与展示投影分开，同时保留统一团队权限模型。',
    '5. PG 载体与压缩协议': '载体正确性由连续提交前缀、同代约束和短事务发布共同保证。',
    '6. 世代切换与客户端生命周期': '换代必须同时隔离服务端在飞写与客户端仍在内存的旧历史。',
    '7. 内容模型、创建者和 Undo': '文本合并、共享类型创建和撤销回收需要一体设计，不可各片独立猜测。',
    '8. exec、产物与退款可靠闭环': '运行态以既有 PG 权威链演进，撤销不参与业务事实排序。',
    '9. 保存屏障与本地持久化': '保存状态必须以可验证的提交证明为边界，不能由同步信号推断。',
    '10. 存储配额、对象身份与审计': '预留、物化、幂等和审计各有独立事务边界，必须明确对账责任。',
    '11. 门禁、不变量与预算': '机器化门禁应证明行为与资源上界，而不是只证明符号存在。',
    '13. 实施顺序与范围重排': '内部按承重关系实现，最终以完整 v4 发布，不部署破坏性半成品。',
    '14. 必须先红后绿的发布门': '以下用例覆盖真实交错、崩溃、违规输入与业务闭环，实施后均须留证。'
}
for i, block in enumerate(blocks):
    if block.startswith('<h2'):
        for title, intro in intros.items():
            if title in block:
                blocks[i] = block + '<p>' + inline(intro) + '</p>'
                break
summary = '<div class="executive-summary"><p><strong>执行摘要：</strong>保留 Yjs 内容协作与既有 PG 业务权威骨架；重写快照提交前缀、世代 fencing、保存确认及执行撤销边界。当前无用户数据，推荐一次建设完整 v4。</p></div>'
summary += '<table><thead><tr><th>审查项</th><th>实际结论</th></tr></thead><tbody><tr><td>代码基线</td><td>c5fc6982</td></tr><tr><td>内存机制验证</td><td>两组纯内存探针</td></tr><tr><td>发布门</td><td>21项待实施验证</td></tr><tr><td>当前执行边界</td><td>未迁移、未部署、未改业务代码</td></tr></tbody></table>'
blocks.insert(2, summary)
css_vars = '\n'.join(key + ': ' + value + ';' for key, value in variables.items())
css = '''
@page { @bottom-center { content: counter(page); } }
:root { TOKENS }
body { max-width:var(--page-content-width); margin-left:auto; margin-right:auto; background:var(--color-background); color:var(--color-text); font-family:var(--typography-fontFamily-body); font-size:var(--typography-fontSize-body); line-height:var(--typography-lineHeight-body); }
.report-body { padding:var(--spacing-block); }
h1 { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-title); color:var(--color-heading); font-weight:var(--fw-bold); text-align:left; margin-top:var(--spacing-block); margin-bottom:var(--spacing-section); }
h2 { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-h2); color:var(--color-primary); font-weight:var(--fw-bold); text-align:left; margin-top:var(--spacing-section); margin-bottom:var(--spacing-paragraph); }
h3 { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-h3); color:var(--color-heading); font-weight:var(--fw-bold); text-align:left; margin-top:var(--spacing-block); margin-bottom:var(--spacing-paragraph); }
p { font-family:var(--typography-fontFamily-body); font-size:var(--typography-fontSize-body); color:var(--color-text); text-indent:var(--spacing-indent); text-align:justify; line-height:var(--typography-lineHeight-body); margin-bottom:var(--spacing-paragraph); }
li { font-family:var(--typography-fontFamily-body); font-size:var(--typography-fontSize-body); color:var(--color-text); line-height:var(--typography-lineHeight-body); text-align:left; text-indent:var(--spacing-block); margin-bottom:var(--spacing-paragraph); }
ul,ol { padding-left:var(--spacing-section); margin-bottom:var(--spacing-block); }
code { font-family:var(--typography-fontFamily-code); font-size:var(--typography-fontSize-h3); color:var(--color-text); background:var(--color-surface); padding:var(--code-pad); overflow-wrap:anywhere; }
a { color:var(--color-primary); overflow-wrap:anywhere; }
strong { font-weight:var(--fw-bold); }
.executive-summary { background:var(--color-surface); padding:var(--spacing-block); margin-bottom:var(--spacing-section); }
table { width:100%; border-collapse:collapse; margin-bottom:var(--spacing-section); }
th,td { border:1px solid var(--color-border); padding:var(--spacing-paragraph); font-family:var(--typography-fontFamily-body); font-size:var(--typography-fontSize-body); color:var(--color-text); text-align:left; }
th { background:var(--color-surface); }
'''.replace('TOKENS', css_vars)
output = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="docx-page-size" content="A4"><title>Y1c架构升级生产级评审报告</title><style>' + css + '</style></head><body><section role="body" class="report-body">' + '\n'.join(blocks) + '</section></body></html>'
path = base / 'stage2/formatted-Y1c架构评审.html'
path.write_text(output, encoding='utf-8')
print(json.dumps({'html_path': str(path), 'headings': heading_count, 'source_chars': len(source), 'html_chars': len(output)}, ensure_ascii=False))
