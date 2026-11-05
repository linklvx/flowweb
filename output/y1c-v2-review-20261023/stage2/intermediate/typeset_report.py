from pathlib import Path
import html
import json
import re

base = Path('D:/flowweb/output/y1c-v2-review-20261023')
source = (base / 'stage1/final_draft.md').read_text(encoding='utf-8')
bundle = json.loads(Path('C:/Users/link/.workbuddy-ai/plugins/cache/workbuddy-builtin/workbuddy-docx/5.8.4-wb.41366630.g73952edb.h4da087921e4a/skills/design-token/tokens/compiled/business-report.json').read_text(encoding='utf-8'))
variables = dict(bundle['css_variables'])
variables.update({'--typography-fontFamily-body':'SimSun, 宋体, serif','--typography-fontSize-body':'12pt','--typography-fontSize-h2':'17pt','--typography-fontSize-h3':'13pt','--spacing-indent':'2em','--spacing-block':'1em','--spacing-section':'1.8em','--page-content-width':'15.6cm','--color-border':'#E0E0E0','--color-muted':'#616161','--code-pad':'0.1em','--fw-bold':'700','--fs-body':'var(--typography-fontSize-body)','--ff-body':'var(--typography-fontFamily-body)'})
bundle['css_variables'] = variables
bundle['overrides_reason'] = 'Chinese engineering review, readable SimSun 12pt body and clear headings.'
(base / 'stage2/design_tokens.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2),encoding='utf-8')

def inline(text):
    stash = []
    def keep(value):
        stash.append(value)
        return f'ZZINLINE{len(stash)-1}ZZ'
    text = re.sub(r'`([^`]+)`',lambda m:keep('<code>'+html.escape(m.group(1))+'</code>'),text)
    text = re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)',lambda m:keep(html.escape(m.group(1))+'（'+html.escape(m.group(2))+'）'),text)
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',text)
    for i,value in enumerate(stash):
        text=text.replace(f'ZZINLINE{i}ZZ',value)
    return text

intros = {
'3. 载体协议：方向正确，仍需五项根修':'提交前缀的新方向可以保留，但必须补齐租约、维护授权与初始快照的可执行约束。',
'4. 原子准入：必须同时证明服务器安全与客户端恢复':'服务器拒绝帧只是第一步，已有客户端历史和多个连接的应用窗口都需要明确协议。',
'6. exec：保留同 doc，但消除双展示源和复合版本回退':'同一个持久投影值需要同时尊重执行顺序和独立槽位修订，不再合并客户端第二状态源。',
'8. 物化、配额和对象删除：必须先持久裁定再执行副作用':'租约前置检查不能原子授权退款或对象删除，决定权需要先写入数据库。',
'10. schema、manifest、预算与范围的剩余纠偏':'版本通道、消费者迁移和容量测试需与实际固定依赖及产品数据口径一致。'
}
blocks=[]
paragraph=[]
list_kind=None
hcount=0

def end_paragraph():
    if paragraph:
        blocks.append('<p>'+inline(' '.join(paragraph))+'</p>')
        paragraph.clear()

def end_list():
    global list_kind
    if list_kind:
        blocks.append('</'+list_kind+'>')
        list_kind=None

lines=source.splitlines()
i=0
while i<len(lines):
    line=lines[i]
    if not line.strip():
        end_paragraph();end_list();i+=1;continue
    if line.startswith('|') and i+1<len(lines) and re.match(r'^\|[-| :]+\|$',lines[i+1]):
        end_paragraph();end_list()
        cells=[x.strip() for x in line.strip().strip('|').split('|')]
        rows=['<table><thead><tr>'+''.join('<th>'+inline(c)+'</th>' for c in cells)+'</tr></thead><tbody>']
        i+=2
        while i<len(lines) and lines[i].startswith('|'):
            row=[x.strip() for x in lines[i].strip().strip('|').split('|')]
            rows.append('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>')
            i+=1
        rows.append('</tbody></table>');blocks.extend(rows);continue
    match=re.match(r'^(#{1,3}) (.*)$',line)
    if match:
        end_paragraph();end_list()
        level=len(match.group(1));hcount+=1
        block=f'<h{level} id="heading-{hcount}">'+inline(match.group(2))+f'</h{level}>'
        if level==2 and match.group(2) in intros:
            block+='<p>'+inline(intros[match.group(2)])+'</p>'
        blocks.append(block);i+=1;continue
    bullet=re.match(r'^- (.*)$',line)
    numbered=re.match(r'^\d+\. (.*)$',line)
    if bullet or numbered:
        end_paragraph()
        desired='ul' if bullet else 'ol'
        if desired!=list_kind:
            end_list();blocks.append('<'+desired+'>');list_kind=desired
        blocks.append('<li>'+inline((bullet or numbered).group(1))+'</li>')
        i+=1;continue
    end_list();paragraph.append(line);i+=1
end_paragraph();end_list()
summary='<div class="executive-summary"><p><strong>复审摘要：</strong>v2方向可保留，仍需补齐提交、准入、拒帧恢复与副作用围栏；不重建全量命令架构，不新增客户端运行态同步平面。</p></div>'
blocks.insert(2,summary)
css_vars='\n'.join(k+': '+v+';' for k,v in variables.items())
css='''
@page { @bottom-center { content: counter(page); } }
@page cover { @bottom-center { content: none; } }
section[role="cover"] { page:cover; }
:root { TOKENS }
body { max-width:var(--page-content-width); margin-left:auto; margin-right:auto; background:var(--color-background); color:var(--color-text); font-family:var(--ff-body); font-size:var(--fs-body); line-height:var(--typography-lineHeight-body); }
.report-body { padding:var(--spacing-block); }
h1 { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-title); color:var(--color-heading); font-weight:var(--fw-bold); text-align:left; margin-bottom:var(--spacing-section); }
h2 { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-h2); color:var(--color-primary); font-weight:var(--fw-bold); text-align:left; margin-top:var(--spacing-section); margin-bottom:var(--spacing-paragraph); }
h3 { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-h3); color:var(--color-heading); font-weight:var(--fw-bold); text-align:left; margin-top:var(--spacing-block); margin-bottom:var(--spacing-paragraph); }
p { font-family:var(--ff-body); font-size:var(--fs-body); color:var(--color-text); text-indent:var(--spacing-indent); text-align:justify; line-height:var(--typography-lineHeight-body); margin-bottom:var(--spacing-paragraph); }
li { font-family:var(--ff-body); font-size:var(--fs-body); color:var(--color-text); line-height:var(--typography-lineHeight-body); text-align:left; margin-bottom:var(--spacing-paragraph); }
ul,ol { padding-left:var(--spacing-section); margin-bottom:var(--spacing-block); }
code { font-family:var(--typography-fontFamily-code); font-size:var(--fs-body); color:var(--color-text); background:var(--color-surface); padding:var(--code-pad); overflow-wrap:anywhere; }
strong { font-weight:var(--fw-bold); }
.executive-summary { background:var(--color-surface); padding:var(--spacing-block); margin-bottom:var(--spacing-section); }
table { width:100%; border-collapse:collapse; margin-bottom:var(--spacing-section); }
th,td { border:1px solid var(--color-border); padding:var(--spacing-paragraph); font-family:var(--ff-body); font-size:var(--fs-body); color:var(--color-text); text-align:left; }
th { background:var(--color-surface); }
.cover-category { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-coverCategory); color:var(--color-primary); font-weight:var(--fw-bold); text-align:center; text-indent:0; margin-top:var(--spacing-section); }
.cover-title { font-family:var(--typography-fontFamily-heading); font-size:var(--typography-fontSize-title); color:var(--color-heading); font-weight:var(--fw-bold); text-align:center; text-indent:0; margin-top:var(--spacing-section); margin-bottom:var(--spacing-section); }
.cover-meta { font-family:var(--ff-body); font-size:var(--fs-body); color:var(--color-muted); text-align:center; text-indent:0; margin-bottom:var(--spacing-block); }
'''.replace('TOKENS',css_vars)
cover='<section role="cover"><p class="cover-category">生产级架构复审 · Yjs / Hocuspocus</p><p class="cover-title">Y1c v2<br>生产级架构复审报告</p><p class="cover-meta">代码基线：9350dfc1</p><p class="cover-meta">2026年10月23日</p><p class="cover-meta">确定方案 · 不覆盖原设计文档</p></section>'
output='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="docx-page-size" content="A4"><title>Y1c-v2生产级架构复审报告</title><style>'+css+'</style></head><body>'+cover+'<section role="body" class="report-body" data-page-restart="1">'+'\n'.join(blocks)+'</section></body></html>'
path=base/'stage2/formatted-Y1c-v2复审.html'
path.write_text(output,encoding='utf-8')
print(json.dumps({'path':str(path),'headings':hcount,'source_chars':len(source),'html_chars':len(output)},ensure_ascii=False))
