import importlib.util
import pathlib
import tempfile
import unittest

path=pathlib.Path(__file__).with_name("28-provision-ksy-telegram-relay.py")
spec=importlib.util.spec_from_file_location("relay",path)
relay=importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)

class Tests(unittest.TestCase):
    def setup_case(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root=pathlib.Path(tmp.name)
        (root/"etc/systemd/system").mkdir(parents=True)
        calls=[]
        installed_rules=set()
        def command(args):
            calls.append(args)
            if args==["ufw","show","added"]: return "ufw allow OpenSSH\n"+"\n".join(sorted(installed_rules))
            if args[:2]==["ufw","allow"]: installed_rules.add(" ".join(args))
            if args[:2]==["ufw","status"]: return "Status: active\n"
            return ""
        return root,calls,command

    def test_install_owned_files_and_narrow_rules(self):
        root,calls,cmd=self.setup_case()
        relay.install(root,cmd,lambda:None)
        self.assertIn(["systemctl","enable","--now","ksy-telegram-relay.socket"],calls)
        rules=[x for x in calls if x[:2]==["ufw","allow"]]
        self.assertEqual(len(rules),3)
        for source in relay.SOURCES: self.assertTrue(any(source in x for x in rules))
        self.assertTrue((root/"etc/systemd/system/ksy-telegram-relay.socket").exists())
        self.assertFalse(any("3proxy" in str(x) for x in calls))

    def test_probe_failure_rolls_back_only_own_state(self):
        root,calls,cmd=self.setup_case()
        sentinel=root/"etc/systemd/system/existing.service"
        sentinel.write_text("unrelated")
        def bad(): raise RuntimeError("probe")
        with self.assertRaises(RuntimeError): relay.install(root,cmd,bad)
        self.assertFalse((root/"etc/systemd/system/ksy-telegram-relay.socket").exists())
        self.assertEqual(sentinel.read_text(),"unrelated")
        self.assertEqual(len([x for x in calls if x[:4]==["ufw","--force","delete","allow"]]),3)
        self.assertFalse(any(x[:2]==["ufw","disable"] for x in calls))

    def test_preexisting_rules_preserved_on_failure(self):
        root,calls,cmd=self.setup_case()
        def prior(args):
            if args==["ufw","show","added"]:return relay.rule_line(relay.SOURCES[0])
            return cmd(args)
        with self.assertRaises(RuntimeError):relay.install(root,prior,lambda:(_ for _ in ()).throw(RuntimeError()))
        deleted=[x for x in calls if x[:3]==["ufw","--force","delete"]]
        self.assertEqual(len(deleted),2)
        self.assertFalse(any(relay.SOURCES[0] in x for x in deleted))

    def test_refuses_file_collision_without_mutation(self):
        root,calls,cmd=self.setup_case()
        file=root/"etc/systemd/system/ksy-telegram-relay.socket"
        file.write_text("another application")
        with self.assertRaises(RuntimeError):relay.install(root,cmd,lambda:None)
        self.assertEqual(file.read_text(),"another application")
        self.assertEqual(calls,[])

    def test_idempotent_install_does_not_restart_or_rewrite(self):
        root,calls,cmd=self.setup_case()
        relay.install(root,cmd,lambda:None)
        calls.clear()
        relay.install(root,cmd,lambda:None)
        self.assertFalse(any(x[:2]==["ufw","allow"] or "enable" in x or "stop" in x for x in calls))

    def test_occupied_port_prevents_changes(self):
        root,calls,cmd=self.setup_case()
        def occupied(args):
            if args[0]=="ss":return "LISTEN"
            return cmd(args)
        with self.assertRaises(RuntimeError):relay.install(root,occupied,lambda:None)
        self.assertEqual(list((root/"etc/systemd/system").iterdir()),[])

if __name__=="__main__":unittest.main()
