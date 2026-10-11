import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contextFor,GENERAL_CONVERSATION,topicConversation,decisionView} from '../web/topics.mjs';

test('A new adventure has its own stable, provider-neutral conversation',()=>{
  assert.equal(contextFor().conversationId,GENERAL_CONVERSATION);
  assert.deepEqual(contextFor('idea-123'),{adventureId:'idea-123',conversationId:'conversation-idea-123'});
  assert.equal(topicConversation('idea-123'),topicConversation('idea-123'));
  assert.throws(()=>topicConversation('../private'),/Invalid adventure/);
});
test('An agreed revision supersedes but never deletes a previous agreement',()=>{
  const items=[
    {id:'a',conversation_id:'conversation-idea-123',body:'Previous plan',status:'locked'},
    {id:'b',conversation_id:'conversation-idea-123',body:'Updated plan',status:'locked',replaces_id:'a'},
    {id:'c',conversation_id:'conversation-idea-123',body:'Another suggestion',status:'proposed'},
    {id:'d',conversation_id:'conversation-shared',body:'Unrelated plan',status:'locked'}
  ];
  const view=decisionView(items,'conversation-idea-123');
  assert.deepEqual(view.current.map(d=>d.id),['b']);
  assert.deepEqual(view.history.map(d=>d.id),['a']);
  assert.deepEqual(view.unresolved.map(d=>d.id),['c']);
  assert.equal(view.hasConflict,false);
  const conflict=decisionView([...items,{id:'e',conversation_id:'conversation-idea-123',status:'locked',replaces_id:'a'}],
    'conversation-idea-123');
  assert.equal(conflict.hasConflict,true);
  assert.deepEqual(conflict.history.find(d=>d.id==='a').superseded_by,['b','e']);
});
