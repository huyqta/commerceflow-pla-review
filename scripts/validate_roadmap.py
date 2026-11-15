#!/usr/bin/env python3
"""Validate PLA roadmap structural completeness and dependency DAG.
Usage: python validate_roadmap.py roadmap.json [--strict]
No third-party dependencies. Not a substitute for testing generated code.
"""
import argparse
import json
import sys
from pathlib import Path

REQUIRED_ISSUE = ('id','title','milestone','depends_on','learning_objectives','steps',
                  'deliverables','acceptance_criteria','verification','estimated_hours',
                  'labels','knowledge','troubleshooting','reflection')
LIST_NONEMPTY = ('learning_objectives','steps','deliverables','acceptance_criteria',
                 'verification','knowledge','troubleshooting')


def validate(data, strict=False):
    errors, warnings = [], []
    if not isinstance(data, dict):
        return ['Top-level roadmap must be an object'], []
    for key in ('schema_version','project_id','domain','content_language','milestones','issues'):
        if key not in data:
            errors.append(f'Missing root field: {key}')
    if data.get('content_language') not in ('vi', 'en'):
        errors.append('content_language must be explicitly selected as vi or en')
    issues = data.get('issues', [])
    milestones = data.get('milestones', [])
    if not isinstance(issues, list) or not issues:
        errors.append('issues must be a nonempty list')
        issues = []
    if not isinstance(milestones, list) or not milestones:
        errors.append('milestones must be a nonempty list')
        milestones = []
    mids = set()
    for m in milestones:
        if not isinstance(m, dict):
            errors.append('Milestone must be an object')
            continue
        mid = m.get('id')
        if not isinstance(mid, str) or not mid.strip():
            errors.append('Milestone has invalid id')
            continue
        if mid in mids: errors.append(f'Duplicate milestone: {mid}')
        mids.add(mid)
        if not isinstance(m.get('gate'), str) or len(m['gate'].strip()) < 8:
            errors.append(f'Milestone {mid}: gate needs observable exit condition')
    ids = set()
    known = {}
    for index, issue in enumerate(issues):
        if not isinstance(issue,dict):
            errors.append(f'Issue at index {index} is not an object')
            continue
        iid = issue.get('id')
        if not isinstance(iid,str) or not iid.strip():
            errors.append(f'Issue at index {index} missing stable id')
            continue
        if iid in ids: errors.append(f'Duplicate issue id: {iid}')
        ids.add(iid)
        known[iid] = issue
        kind = issue.get('kind')
        if kind not in ('foundations','environment','lab','implementation','review','release'):
            errors.append(f'{iid}: invalid or missing kind')
        status=issue.get('verification_status')
        if status not in ('draft/unverified','reviewed','verified','blocked','failed'):
            errors.append(f'{iid}: invalid or missing verification_status')
        evidence=issue.get('verification_evidence')
        if status=='verified' and (not isinstance(evidence,str) or not evidence.strip()):
            errors.append(f'{iid}: verified requires a nonempty verification_evidence path')
        for key in REQUIRED_ISSUE:
            if key not in issue: errors.append(f'{iid}: missing {key}')
        if issue.get('milestone') not in mids:
            errors.append(f'{iid}: unknown milestone {issue.get("milestone")}')
        deps = issue.get('depends_on', [])
        if not isinstance(deps,list):
            errors.append(f'{iid}: depends_on must be a list')
        elif len(deps) != len(set(str(d) for d in deps)):
            errors.append(f'{iid}: duplicate dependencies')
        for key in LIST_NONEMPTY:
            val = issue.get(key)
            if not isinstance(val,list) or not val or any(not isinstance(x,str) or not x.strip() for x in val):
                errors.append(f'{iid}: {key} must be a nonempty list of strings')
        if isinstance(issue.get('steps'),list) and len(issue['steps']) < 2:
            warnings.append(f'{iid}: only one step; check step-by-step depth')
        h=issue.get('estimated_hours')
        if not isinstance(h,(int,float)) or isinstance(h,bool) or h <= 0:
            errors.append(f'{iid}: estimated_hours must be positive')
        if not isinstance(issue.get('reflection'),str) or len(issue['reflection'].strip()) < 8:
            errors.append(f'{iid}: reflection is too short')
        if not isinstance(issue.get('title'),str) or len(issue['title'].strip()) < 5:
            errors.append(f'{iid}: title too short')
    graph = {}
    for iid,issue in known.items():
        deps=issue.get('depends_on',[])
        if not isinstance(deps,list): deps=[]
        graph[iid]=[]
        for dep in deps:
            if dep == iid: errors.append(f'{iid}: self-dependency')
            elif dep not in ids: errors.append(f'{iid}: unknown dependency {dep}')
            else: graph[iid].append(dep)
    # Every hands-on issue must transitively depend on foundations and environment.
    foundation_ids={iid for iid,v in known.items() if v.get('kind')=='foundations'}
    environment_ids={iid for iid,v in known.items() if v.get('kind')=='environment'}
    if not foundation_ids: errors.append('Missing dedicated foundations issue')
    if not environment_ids: errors.append('Missing dedicated environment issue')
    def ancestors(node, seen=None):
        seen = set() if seen is None else seen
        for dep in graph.get(node, []):
            if dep not in seen:
                seen.add(dep)
                ancestors(dep,seen)
        return seen
    for iid,v in known.items():
        prior=ancestors(iid)
        if v.get('kind')=='environment' and not (prior & foundation_ids):
            errors.append(f'{iid}: environment issue must depend on foundations')
        if v.get('kind') in ('lab','implementation','release'):
            if not (prior & foundation_ids): errors.append(f'{iid}: missing foundations dependency path')
            if not (prior & environment_ids): errors.append(f'{iid}: missing environment dependency path')
    state={}
    def visit(node,path):
        if state.get(node)==1:
            errors.append('Dependency cycle: '+' -> '.join(path+[node]));return
        if state.get(node)==2:return
        state[node]=1
        for dep in graph[node]:visit(dep,path+[node])
        state[node]=2
    for node in graph:visit(node,[])
    counts={mid:0 for mid in mids}
    for issue in known.values():
        if issue.get('milestone') in counts:counts[issue['milestone']]+=1
    for mid,count in counts.items():
        if count==0:errors.append(f'Milestone {mid} has no issues')
    if len(known)>1:
        roots=[iid for iid,deps in graph.items() if not deps]
        if len(roots)>max(3,len(known)//2):
            warnings.append('Many root issues; review fragmented learning dependency graph')
    if not data.get('domain') or not isinstance(data.get('domain'),list):
        errors.append('domain must be nonempty list')
    if strict:
        errors.extend('Strict: '+msg for msg in warnings)
    return errors,warnings


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('roadmap',type=Path)
    parser.add_argument('--strict',action='store_true')
    args=parser.parse_args()
    try:
        data=json.loads(args.roadmap.read_text(encoding='utf-8'))
    except (OSError,json.JSONDecodeError) as exc:
        print('FAIL: unable to read JSON:',exc,file=sys.stderr);return 2
    errors,warnings=validate(data,args.strict)
    for msg in errors:print('ERROR:',msg)
    for msg in warnings:print('WARN:',msg)
    print(f'{"PASS" if not errors else "FAIL"}: {len(data.get("issues",[]))} issues, {len(data.get("milestones",[]))} milestones; {len(errors)} errors, {len(warnings)} warnings')
    return 1 if errors else 0

if __name__=='__main__':sys.exit(main())
