const invite=document.getElementById('invite');
if(invite&&/^[a-f0-9]{64}$/.test(location.hash.slice(1))){invite.value=location.hash.slice(1);history.replaceState(null,'',location.pathname);}
if(invite&&/^[a-f0-9]{64}$/.test(invite.value)){invite.readOnly=true;invite.closest('label').hidden=true;}
